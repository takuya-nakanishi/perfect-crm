"""アカウント(04 §16)。ログイン中の本人が、自分のパスワード・2 段階認証・Google と Microsoft・
ログイン中の端末を扱う(05 §15)。

パスワードと 2 段階認証を変える・Google と Microsoft を結ぶには、**10 分以内にログインしたこと**が要る
(パスワードを変えるときは、いまのパスワードでもよい。03 §5)。
"""

import uuid
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update

from app.api.deps import Conn, CurrentUser
from app.api.session import CodeBody, error, too_many
from app.auth import challenges, oidc, passwords, sessions, throttle, totp
from app.errors import ApiError, not_found
from app.meta import store
from app.meta.tables import user_sessions, users

router = APIRouter()


class PasswordBody(BaseModel):
    current_password: str | None = None
    new_password: str


def _iso(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def _me(request: Request) -> Any:
    """`current_user` が置いた、セッションと利用者の 1 行。"""
    return request.state.auth


@router.get("/account")
def read_account(request: Request, user: CurrentUser) -> dict[str, Any]:
    me = _me(request)
    return {
        "has_password": me.password_hash is not None,
        "password_changed_at": _iso(me.password_changed_at),
        "totp_enabled_at": _iso(me.totp_enabled_at),
        "google_email": me.google_email,
        "microsoft_email": me.microsoft_email,
        "recent_login": sessions.is_recent(me.session_created_at),
    }


@router.put("/account/password")
def change_password(body: PasswordBody, request: Request, user: CurrentUser, conn: Conn) -> Response:
    """通ったら、この端末以外のセッションと、アプリの許可(Android・Claude)をすべて切る。"""
    me = _me(request)
    if not sessions.is_recent(me.session_created_at):
        if me.password_hash is None:
            raise ApiError(
                400, "reauth_required", "もう一度ログインしてから決めてください(10 分以内のログインが要ります)"
            )
        if not body.current_password:
            raise ApiError(400, "reauth_required", "いまのパスワードを入れてください")
        ip = sessions.client_ip(request)
        wait = throttle.check(conn, user_id=me.id, ip=ip)
        if wait:
            throttle.record_throttled(conn, email=me.email, user_id=me.id, method="password", ip=ip)
            return too_many(wait)
        if not passwords.verify(me.password_hash, body.current_password):
            # ログインの間引きと同じ数えに入れる(ここを総当たりの抜け道にしない)
            throttle.record(
                conn, email=me.email, user_id=me.id, method="password", ip=ip, succeeded=False, reason="bad_password"
            )
            return error(400, "invalid_credentials", "いまのパスワードが違います")

    reason = passwords.problem(
        body.new_password, email=me.email, name=me.name, workspace_name=store.get_workspace(conn)["name"]
    )
    if reason:
        raise ApiError(400, "weak_password", reason)
    conn.execute(
        update(users)
        .where(users.c.id == me.id)
        .values(password_hash=passwords.hash_password(body.new_password), password_changed_at=func.clock_timestamp())
    )
    sessions.revoke_all(conn, me.id, keep=me.session_id, apps=True)
    challenges.drop_all(conn, me.id)
    return Response(status_code=204)


@router.post("/account/totp")
def start_totp(request: Request, user: CurrentUser, conn: Conn) -> dict[str, Any]:
    """2 段階認証を(やり直して)設定し始める。新しい秘密は、6 桁が通るまで設定中として持つ。"""
    me = _me(request)
    if not sessions.is_recent(me.session_created_at):
        raise ApiError(
            400,
            "reauth_required",
            "2 段階認証を設定し直すには、ログインし直してください(10 分以内のログインが要ります)",
        )
    secret = totp.new_secret()
    conn.execute(update(users).where(users.c.id == me.id).values(totp_pending_secret=totp.encrypt(secret)))
    return totp.setup(secret, email=me.email, issuer=store.get_workspace(conn)["name"])


@router.put("/account/totp", status_code=204)
def confirm_totp(body: CodeBody, request: Request, user: CurrentUser, conn: Conn) -> None:
    """設定中の秘密で 6 桁が通ったら入れ替える(古い端末のコードは効かなくなる)。外す口は持たない。"""
    me = _me(request)
    pending = me.totp_pending_secret
    secret = totp.decrypt(pending)
    if secret is None:
        raise ApiError(400, "totp_not_started", "設定を始めからやり直してください")
    step = totp.matched_step(secret, body.code, last_step=None)
    if step is None:
        raise ApiError(
            400, "invalid_code", "確認コードが違います。認証アプリの 6 桁と、端末の時刻が合っているかを確かめてください"
        )
    conn.execute(
        update(users)
        .where(users.c.id == me.id)
        .values(
            totp_secret=pending, totp_pending_secret=None, totp_enabled_at=func.clock_timestamp(), totp_last_step=step
        )
    )


@router.get("/account/sessions")
def list_sessions(request: Request, user: CurrentUser, conn: Conn) -> list[dict[str, Any]]:
    """ログイン中の端末(ブラウザのセッション)。Android アプリの許可は J-056 で足す。"""
    me = _me(request)
    rows = conn.execute(
        select(user_sessions)
        .where(user_sessions.c.user_id == me.id, user_sessions.c.expires_at > func.clock_timestamp())
        .order_by(user_sessions.c.last_seen_at.desc())
    ).all()
    return [
        {
            "id": str(r.id),
            "kind": "browser",
            "label": sessions.describe(r.user_agent),
            "created_at": _iso(r.created_at),
            "last_seen_at": _iso(r.last_seen_at),
            "current": r.id == me.session_id,
        }
        for r in rows
    ]


@router.delete("/account/sessions/{session_id}", status_code=204)
def revoke_session(session_id: str, request: Request, user: CurrentUser, conn: Conn) -> None:
    me = _me(request)
    try:
        target = uuid.UUID(session_id)
    except ValueError as exc:
        raise not_found() from exc
    removed = conn.execute(
        delete(user_sessions)
        .where(user_sessions.c.id == target, user_sessions.c.user_id == me.id)
        .returning(user_sessions.c.id)
    ).first()
    if removed is None:
        raise not_found()


@router.delete("/account/sessions", status_code=204)
def revoke_other_sessions(request: Request, user: CurrentUser, conn: Conn) -> None:
    """いま使っている端末以外を、すべて切る。"""
    me = _me(request)
    sessions.revoke_all(conn, me.id, keep=me.session_id)


@router.post("/account/identities/{provider}")
def start_link(provider: oidc.Provider, request: Request, user: CurrentUser) -> Response:
    """Google・Microsoft を結び始める。許可の画面の URL を返す(画面はそこへページごと移る)。

    戻りは `/session/{provider}/callback`(ログインと同じ口。Cookie の状態で、結ぶのか入るのかを見分ける)。

    入る手段を足すことなので、10 分以内のログインが要る(盗まれたセッションから、他人のアカウントを結ばせない)。
    """
    me = _me(request)
    label = oidc.LABELS[provider]
    if not oidc.enabled(provider):
        raise ApiError(409, "not_configured", f"{label} でのログインは、まだ設定されていません")
    if not sessions.is_recent(me.session_created_at):
        raise ApiError(
            400, "reauth_required", f"{label} を結ぶには、ログインし直してください(10 分以内のログインが要ります)"
        )
    try:
        url, flow = oidc.start(provider, next_path="/account", user_id=str(me.id))
    except oidc.OidcError as exc:
        raise ApiError(
            502, "provider_unavailable", f"{label} に繋がりませんでした。少し待ってからもう一度お試しください"
        ) from exc
    response = JSONResponse({"url": url})
    sessions.set_cookie(response, oidc.cookie(), flow, oidc.FLOW_TTL)
    return response


@router.delete("/account/identities/{provider}", status_code=204)
def unlink(provider: oidc.Provider, request: Request, user: CurrentUser, conn: Conn) -> None:
    """外す。ほかに入る手段(パスワードか、もう一方)が残るときだけ。"""
    me = _me(request)
    others = [me.password_hash, *(getattr(me, f"{p}_sub") for p in oidc.PROVIDERS if p != provider)]
    if all(v is None for v in others):
        raise ApiError(
            409, "last_login_method", "ほかに入る方法が無くなるので外せません。先にパスワードを決めてください"
        )
    conn.execute(update(users).where(users.c.id == me.id).values({f"{provider}_sub": None, f"{provider}_email": None}))
