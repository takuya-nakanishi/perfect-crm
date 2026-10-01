"""ログイン(04 §16 の `/session`)。アプリ自身が持つ(03 §5。01 D-14)。

入り方は 3 つ。**2 段目が通るまでセッションは作らない。**
- パスワード: 1 段目はメールアドレスとパスワード、2 段目は TOTP の 6 桁
- Google: Google が確かめたら入る(2 段目は Google 側に任せる。対象が Workspace の利用者だけなので、管理者が必須にできる)
- Microsoft: Microsoft が確かめたら 2 段目(TOTP)へ(Microsoft 側の 2 段階認証は、Works から確かめられないため)

失敗は `login_attempts` に残して数える(待たせるため)。だから失敗は例外で投げず、応答として返す
(例外にすると、1 リクエスト = 1 トランザクションが巻き戻り、記録も消える)。

手前に門(Cloudflare Access)を置かないので、ここはインターネットのだれからでも届く(01 D-14)。
"""

import hmac
import logging
from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import Connection, func, select, update

from app.api.deps import Conn, CurrentUser, check_origin, user_dict
from app.auth import challenges, oidc, passwords, sessions, throttle, totp
from app.auth.throttle import Wait
from app.errors import bad_request
from app.meta import store
from app.meta.tables import users

router = APIRouter()
log = logging.getLogger(__name__)


class LoginBody(BaseModel):
    email: str
    password: str = ""


class CodeBody(BaseModel):
    code: str


def error(status: int, code: str, message: str) -> JSONResponse:
    """記録を残したまま返す失敗(04 §1 と同じ形)。"""
    return JSONResponse(status_code=status, content={"code": code, "message": message})


def too_many(wait: Wait) -> JSONResponse:
    response = error(429, "too_many_attempts", wait.message)
    if wait.retry_after is not None:
        response.headers["Retry-After"] = str(wait.retry_after)
    return response


def safe_next(value: str | None) -> str:
    """戻り先は同じオリジンの中の道だけ(`/` で始まり `//` で始まらない)。外の URL は `/` に置き換える。"""
    if value and value.startswith("/") and not value.startswith("//") and "\\" not in value and value.isprintable():
        return value
    return "/"


@router.get("/session")
def read_session(user: CurrentUser, conn: Conn) -> dict[str, Any]:
    return {"user": user, "workspace": store.get_workspace(conn)}


@router.get("/session/options")
def session_options() -> dict[str, bool]:
    """ログインの画面が出すもの(未ログインで読める)。Google・Microsoft のボタンを出すか。"""
    return {provider: oidc.enabled(provider) for provider in oidc.PROVIDERS}


def _second_step(conn: Connection, user: Any) -> dict[str, Any]:
    """2 段目に画面が出すもの(`status` が札の purpose になる)。

    2 段階認証がまだ(か、WORKS_SECRET_KEY が変わって読めない)なら、設定中の秘密を作り、設定してから入る。
    """
    if totp.decrypt(user.totp_secret) is None:
        secret = totp.new_secret()
        conn.execute(update(users).where(users.c.id == user.id).values(totp_pending_secret=totp.encrypt(secret)))
        issuer = store.get_workspace(conn)["name"]
        return {"status": "totp_setup", "setup": totp.setup(secret, email=user.email, issuer=issuer)}
    return {"status": "totp"}


@router.post("/session")
def login(body: LoginBody, request: Request, conn: Conn) -> Response:
    check_origin(request)
    email = body.email.strip().lower()
    if not email or not body.password:
        raise bad_request("メールアドレスとパスワードを入れてください")
    ip = sessions.client_ip(request)
    user = conn.execute(select(users).where(users.c.email == email, users.c.deleted_at.is_(None))).first()
    user_id = user.id if user else None

    wait = throttle.check(conn, user_id=user_id, ip=ip)
    if wait:
        throttle.record_throttled(conn, email=email, user_id=user_id, method="password", ip=ip)
        return too_many(wait)
    # 利用者がいない・パスワードを持たないときも、同じだけ時間を掛けて同じ文を返す
    if user is None or not passwords.verify(user.password_hash, body.password):
        throttle.record(
            conn,
            email=email,
            user_id=user_id,
            method="password",
            ip=ip,
            succeeded=False,
            reason="no_user" if user is None else "bad_password",
        )
        return error(401, "invalid_credentials", "メールアドレスかパスワードが違います")
    if passwords.needs_rehash(user.password_hash):
        conn.execute(
            update(users).where(users.c.id == user.id).values(password_hash=passwords.hash_password(body.password))
        )

    result = _second_step(conn, user)
    response = JSONResponse(result)
    challenges.create(conn, response, user.id, result["status"], "password")
    return response


def _expired(message: str = "時間が経ちすぎました。もう一度ログインしてください") -> JSONResponse:
    response = error(401, "login_expired", message)
    sessions.clear_cookie(response, challenges.cookie())
    return response


@router.get("/session/challenge")
def read_challenge(request: Request, conn: Conn) -> Response:
    """待っている 2 段目を読み直す(Microsoft から戻って開いたログインの画面が読む)。札が無い・切れた → 401。"""
    challenge = challenges.current(conn, request)
    if challenge is None:
        return _expired()
    user = conn.execute(select(users).where(users.c.id == challenge.user_id, users.c.deleted_at.is_(None))).first()
    if user is None:
        return _expired()
    if challenge.purpose != "totp_setup":
        return JSONResponse({"status": "totp"})
    secret = totp.decrypt(user.totp_pending_secret)
    if secret is None:
        return _expired("2 段階認証の設定を読めませんでした。もう一度ログインしてください")
    issuer = store.get_workspace(conn)["name"]
    return JSONResponse({"status": "totp_setup", "setup": totp.setup(secret, email=user.email, issuer=issuer)})


@router.post("/session/totp")
def login_totp(body: CodeBody, request: Request, conn: Conn) -> Response:
    """2 段目。札(Cookie)の 6 桁が通ったらセッションを作る。設定の札なら、設定も一緒に済ませる。"""
    check_origin(request)
    challenge = challenges.current(conn, request)
    if challenge is None:
        return _expired()
    user = conn.execute(select(users).where(users.c.id == challenge.user_id, users.c.deleted_at.is_(None))).first()
    if user is None:
        return _expired()
    ip = sessions.client_ip(request)
    wait = throttle.check(conn, user_id=user.id, ip=ip)
    if wait:
        throttle.record_throttled(conn, email=user.email, user_id=user.id, method="totp", ip=ip)
        return too_many(wait)

    setup = challenge.purpose == "totp_setup"
    stored = user.totp_pending_secret if setup else user.totp_secret
    secret = totp.decrypt(stored)
    if secret is None:
        response = _expired("2 段階認証の設定を読めませんでした。もう一度ログインしてください")
        challenges.finish(conn, response, challenge.token_hash)
        return response
    step = totp.matched_step(secret, body.code, last_step=None if setup else user.totp_last_step)
    if step is None:
        throttle.record(
            conn, email=user.email, user_id=user.id, method="totp", ip=ip, succeeded=False, reason="bad_code"
        )
        if challenges.count_try(conn, challenge.token_hash) >= challenges.MAX_TRIES:
            response = _expired("確認コードを 5 回違えました。もう一度ログインしてください")
            challenges.finish(conn, response, challenge.token_hash)
            return response
        return error(
            400, "invalid_code", "確認コードが違います。認証アプリの 6 桁と、端末の時刻が合っているかを確かめてください"
        )

    values: dict[str, Any] = {"totp_last_step": step}
    if setup:
        values.update(totp_secret=stored, totp_pending_secret=None, totp_enabled_at=func.clock_timestamp())
    conn.execute(update(users).where(users.c.id == user.id).values(**values))
    throttle.record(conn, email=user.email, user_id=user.id, method=challenge.method, ip=ip, succeeded=True)
    sessions.sweep(conn)
    response = JSONResponse({"user": user_dict(user), "workspace": store.get_workspace(conn)})
    challenges.finish(conn, response, challenge.token_hash)
    sessions.create(conn, request, response, user.id, challenge.method)
    return response


@router.delete("/session")
def logout(request: Request, conn: Conn) -> Response:
    check_origin(request)
    sessions.delete_current(conn, request)
    response = Response(status_code=204)
    sessions.clear_cookie(response, sessions.session_cookie())
    return response


# --- Google・Microsoft でログイン(OpenID Connect)-------------------------------------------------


def _redirect(target: str) -> RedirectResponse:
    """303 で画面へ戻す(途中の状態の Cookie は、どの結果でも消す)。"""
    response = RedirectResponse(target, status_code=303)
    oidc.clear(response)
    return response


@router.get("/session/{provider}")
def start_login(provider: oidc.Provider, next: str | None = None) -> Response:
    """ページごと提供元の許可の画面へ送る(画面はリンクで開く。fetch しない)。状態は署名した短命の Cookie に置く。"""
    next_path = safe_next(next)
    if not oidc.enabled(provider):
        return _redirect(f"/login?{urlencode({'error': f'{provider}_not_configured', 'next': next_path})}")
    try:
        url, flow = oidc.start(provider, next_path=next_path)
    except oidc.OidcError as exc:
        log.warning("%s のログインを始められなかった: %s", oidc.LABELS[provider], exc)
        return _redirect(f"/login?{urlencode({'error': f'{provider}_failed', 'next': next_path})}")
    response = RedirectResponse(url, status_code=303)
    sessions.set_cookie(response, oidc.cookie(), flow, oidc.FLOW_TTL)
    return response


def _failed(provider: str, reason: str, flow: oidc.Flow | None) -> RedirectResponse:
    """入れなかった・結べなかった。ログインならログインの画面、結ぶならアカウントの画面へ、理由の符号を付けて戻す。"""
    code = f"{provider}_{reason}"
    if flow is not None and flow.user_id is not None:
        return _redirect(f"/account?{urlencode({'link_error': code})}")
    return _redirect(f"/login?{urlencode({'error': code, 'next': flow.next_path if flow else '/'})}")


@router.get("/session/{provider}/callback")
def provider_callback(
    provider: oidc.Provider,
    request: Request,
    conn: Conn,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> Response:
    """提供元からの戻り。state を Cookie と照らしてから、だれかを確かめる。

    ログインなら入れ(Microsoft は 2 段目へ)、結ぶならアカウントの画面へ戻す。
    """
    flow = oidc.read_flow(request.cookies.get(oidc.cookie()))
    if flow is not None and (flow.provider != provider or not state or not hmac.compare_digest(flow.state, state)):
        # 他人が用意した戻りの URL を踏まされた・別のタブで始め直した。どちらも受けない
        flow = None
    if flow is None:
        return _failed(provider, "failed", None)
    if error or not code:
        return _failed(provider, "denied" if error == "access_denied" else "failed", flow)
    try:
        identity = oidc.finish(flow, code, sessions.client_ip(request))
    except oidc.TooManyExchanges:
        return _failed(provider, "busy", flow)
    except oidc.OidcError as exc:
        log.warning("%s の戻りを受け付けなかった: %s", oidc.LABELS[provider], exc)
        return _failed(provider, "failed", flow)
    if flow.user_id is not None:
        return _link(conn, request, flow, identity)
    return _login_with(conn, request, flow, identity)


def _login_with(conn: Connection, request: Request, flow: oidc.Flow, identity: oidc.Identity) -> Response:
    provider = identity.provider
    sub = users.c[f"{provider}_sub"]
    ip = sessions.client_ip(request)
    # 結んである人を引く。消した人に結ばれていたら入れない(ほかの人へ結び直しもしない)
    user = conn.execute(select(users).where(sub == identity.subject)).first()
    if user is None and identity.verified:
        # 初めて: 提供元が確かめたアドレスで利用者を探し、見つかれば結ぶ(以後は sub で引く。03 §5)
        user = conn.execute(
            select(users).where(users.c.email == identity.email, sub.is_(None), users.c.deleted_at.is_(None))
        ).first()
    if user is None or user.deleted_at is not None:
        throttle.record(
            conn, email=identity.email, user_id=None, method=provider, ip=ip, succeeded=False, reason="not_registered"
        )
        return _failed(provider, "not_registered", flow)
    conn.execute(
        update(users)
        .where(users.c.id == user.id)
        .values({sub.name: identity.subject, f"{provider}_email": identity.email or None})
    )

    if provider == "microsoft":
        # Microsoft 側の 2 段階認証は確かめられないので、Works の 6 桁へ。ログインの画面が札を読んで続ける
        response = _redirect(f"/login?{urlencode({'continue': provider, 'next': flow.next_path})}")
        challenges.create(conn, response, user.id, _second_step(conn, user)["status"], provider)
        return response
    throttle.record(conn, email=user.email, user_id=user.id, method=provider, ip=ip, succeeded=True)
    sessions.sweep(conn)
    response = _redirect(flow.next_path)
    sessions.create(conn, request, response, user.id, provider)
    return response


def _link(conn: Connection, request: Request, flow: oidc.Flow, identity: oidc.Identity) -> Response:
    """アカウントの画面から結ぶ。始めた人と同じ人が、まだログインしていること。"""
    provider = identity.provider
    me = sessions.current(conn, request)
    if me is None or str(me.id) != flow.user_id:
        return _failed(provider, "failed", flow)
    sub = users.c[f"{provider}_sub"]
    holder = conn.execute(select(users.c.id).where(sub == identity.subject)).first()
    if holder is not None and holder.id != me.id:
        return _failed(provider, "in_use", flow)
    conn.execute(
        update(users)
        .where(users.c.id == me.id)
        .values({sub.name: identity.subject, f"{provider}_email": identity.email or None})
    )
    return _redirect(f"/account?{urlencode({'linked': provider})}")
