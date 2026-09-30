"""ログイン(04 §16 の `/session`)。アプリ自身が持つ(03 §5。01 D-14)。

1 段目はメールアドレスとパスワード、2 段目は TOTP の 6 桁。**2 段目が通るまでセッションは作らない。**
失敗は `login_attempts` に残して数える(待たせるため)。だから失敗は例外で投げず、応答として返す
(例外にすると、1 リクエスト = 1 トランザクションが巻き戻り、記録も消える)。

`WORKS_AUTH=access`(本番を切り替える J-055 まで)は Cloudflare Access が門で、ここのログインは使わない。
"""

from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import func, select, update

from app.api.deps import Conn, CurrentUser, check_origin, user_dict
from app.auth import challenges, passwords, sessions, throttle, totp
from app.auth.throttle import Wait
from app.config import get_settings
from app.errors import ApiError, bad_request
from app.meta import store
from app.meta.tables import users

router = APIRouter()

# Access のログアウト。Cloudflare の縁で受けるので、アプリには届かない
ACCESS_LOGOUT_URL = "/cdn-cgi/access/logout"


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


def require_local() -> None:
    if get_settings().auth != "local":
        raise ApiError(400, "access_login", "いまのログインは Cloudflare Access で行います")


@router.get("/session")
def read_session(user: CurrentUser, conn: Conn) -> dict[str, Any]:
    return {"user": user, "workspace": store.get_workspace(conn)}


@router.get("/session/options")
def session_options() -> dict[str, bool]:
    """ログインの画面が出すもの(未ログインで読める)。Google でログインは J-054 で開ける。"""
    return {"google": False}


@router.post("/session")
def login(body: LoginBody, request: Request, conn: Conn) -> Response:
    check_origin(request)
    require_local()
    email = body.email.strip().lower()
    if not email or not body.password:
        raise bad_request("メールアドレスとパスワードを入れてください")
    ip = sessions.client_ip(request)
    user = conn.execute(select(users).where(users.c.email == email, users.c.deleted_at.is_(None))).first()
    user_id = user.id if user else None

    wait = throttle.check(conn, user_id=user_id, ip=ip)
    if wait:
        throttle.record(
            conn, email=email, user_id=user_id, method="password", ip=ip, succeeded=False, reason="throttled"
        )
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

    if totp.decrypt(user.totp_secret) is None:
        # 2 段階認証がまだ(か、WORKS_SECRET_KEY が変わって読めない)。設定してから入る
        secret = totp.new_secret()
        conn.execute(update(users).where(users.c.id == user.id).values(totp_pending_secret=totp.encrypt(secret)))
        issuer = store.get_workspace(conn)["name"]
        response = JSONResponse({"status": "totp_setup", "setup": totp.setup(secret, email=user.email, issuer=issuer)})
        challenges.create(conn, response, user.id, "totp_setup")
    else:
        response = JSONResponse({"status": "totp"})
        challenges.create(conn, response, user.id, "totp")
    return response


def _expired(message: str = "時間が経ちすぎました。もう一度ログインしてください") -> JSONResponse:
    response = error(401, "login_expired", message)
    sessions.clear_cookie(response, challenges.cookie())
    return response


@router.post("/session/totp")
def login_totp(body: CodeBody, request: Request, conn: Conn) -> Response:
    """2 段目。札(Cookie)の 6 桁が通ったらセッションを作る。設定の札なら、設定も一緒に済ませる。"""
    check_origin(request)
    require_local()
    challenge = challenges.current(conn, request)
    if challenge is None:
        return _expired()
    user = conn.execute(select(users).where(users.c.id == challenge.user_id, users.c.deleted_at.is_(None))).first()
    if user is None:
        return _expired()
    ip = sessions.client_ip(request)
    wait = throttle.check(conn, user_id=user.id, ip=ip)
    if wait:
        throttle.record(
            conn, email=user.email, user_id=user.id, method="totp", ip=ip, succeeded=False, reason="throttled"
        )
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
    throttle.record(conn, email=user.email, user_id=user.id, method="password", ip=ip, succeeded=True)
    sessions.sweep(conn)
    response = JSONResponse({"user": user_dict(user), "workspace": store.get_workspace(conn)})
    challenges.finish(conn, response, challenge.token_hash)
    sessions.create(conn, request, response, user.id, "password")
    return response


@router.delete("/session")
def logout(request: Request, conn: Conn) -> Response:
    check_origin(request)
    if get_settings().auth == "access":
        # アプリは Cookie を持たないので、Access のセッションを切ってもらう(画面はこの URL へ移る)
        return JSONResponse({"logout_url": ACCESS_LOGOUT_URL})
    sessions.delete_current(conn, request)
    response = Response(status_code=204)
    sessions.clear_cookie(response, sessions.session_cookie())
    return response
