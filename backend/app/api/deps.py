"""FastAPI の依存。いまログインしている利用者を決める(03 §5)。

`WORKS_AUTH=local`(既定)はアプリ自身のログイン(セッションの Cookie。`app/auth/sessions.py`)で決める。
`access` は Cloudflare Access の JWT のメールアドレスで決める(本番を切り替える J-055 までの形)。
"""

from typing import Annotated, Any
from urllib.parse import urlparse

from fastapi import Depends, Request
from sqlalchemy import Connection, select

from app import access
from app.auth import sessions
from app.config import get_settings
from app.db import connection
from app.errors import ApiError, forbidden
from app.meta.tables import users

Conn = Annotated[Connection, Depends(connection)]
# 関数を抜けたところで確定する接続(既定の `Conn` は応答を送ったあとで確定する)。
# Web フォームの受け口が、送り手に「受け付けました」を返す前に確定させるため(確定すると、ワークフローの送り係も起きる)
CommittedConn = Annotated[Connection, Depends(connection, scope="function")]

# 読む以外の要求。Cookie で入った書き込みは、公開 URL と同じオリジンからのものだけを受ける(03 §5 の CSRF)
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def unauthenticated() -> ApiError:
    return ApiError(401, "unauthenticated", "ログインしてください")


def public_origin() -> str:
    parsed = urlparse(get_settings().public_url)
    return f"{parsed.scheme}://{parsed.netloc}"


def check_origin(request: Request) -> None:
    """よそのサイトから、ログイン中の人の Cookie を使って書かせない。`SameSite=Lax` と重ねる。

    ブラウザは書き込み(POST・PUT・PATCH・DELETE)に必ず `Origin` を付ける。無い・違う → 403。
    """
    if request.method in UNSAFE_METHODS and request.headers.get("origin") != public_origin():
        raise ApiError(403, "bad_origin", "別のサイトからの書き込みは受け付けません。Works の画面から操作してください")


def user_dict(row: Any) -> dict[str, Any]:
    user: dict[str, Any] = {
        "id": str(row.id),
        "name": row.name,
        "email": row.email,
        "avatar_color": row.avatar_color,
    }
    if row.admin:
        user["admin"] = True
    return user


def current_user(request: Request, conn: Conn) -> dict[str, Any]:
    check_origin(request)
    if get_settings().auth == "access":
        email = access.verify(request.headers.get(access.HEADER))
        row = conn.execute(select(users).where(users.c.email == email, users.c.deleted_at.is_(None))).first()
        if row is None:
            # Access は通ったが、Works の利用者ではない。足すのは管理者(`python -m app.cli add-user`)
            raise ApiError(403, "not_registered", f"{email} は Works の利用者として登録されていません")
        return user_dict(row)

    row = sessions.current(conn, request)
    if row is None:
        raise unauthenticated()
    # アカウントの画面(「さっきログインしたか」「この端末か」)が使う
    request.state.auth = row
    return user_dict(row)


CurrentUser = Annotated[dict[str, Any], Depends(current_user)]


def require_admin(user: CurrentUser) -> dict[str, Any]:
    """環境設定(テーブル定義・Web フォーム・MCP トークン)を触れるのは管理者だけ(03 §5)。"""
    if not user.get("admin"):
        raise forbidden()
    return user


Admin = Annotated[dict[str, Any], Depends(require_admin)]
