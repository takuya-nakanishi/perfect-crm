"""FastAPI の依存。いまログインしている利用者を決める(03 §5)。

本番(`WORKS_AUTH=access`)は Cloudflare Access の JWT のメールアドレスで、`dev` は署名付きの Cookie で決める。
"""

from typing import Annotated, Any

from fastapi import Depends, Request
from sqlalchemy import Connection, select

from app import access
from app.config import get_settings
from app.db import connection
from app.errors import ApiError, forbidden, unauthorized
from app.meta.tables import users
from app.security import COOKIE_NAME, verify

Conn = Annotated[Connection, Depends(connection)]


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
    alive = users.c.deleted_at.is_(None)
    if get_settings().auth == "access":
        email = access.verify(request.headers.get(access.HEADER))
        row = conn.execute(select(users).where(users.c.email == email, alive)).first()
        if row is None:
            # Access は通ったが、Works の利用者ではない。足すのは管理者(`python -m app.cli add-user`)
            raise ApiError(403, "not_registered", f"{email} は Works の利用者として登録されていません")
        return user_dict(row)

    user_id = verify(request.cookies.get(COOKIE_NAME))
    if not user_id:
        raise unauthorized()
    row = conn.execute(select(users).where(users.c.id == user_id, alive)).first()
    if row is None:
        raise unauthorized()
    return user_dict(row)


CurrentUser = Annotated[dict[str, Any], Depends(current_user)]


def require_admin(user: CurrentUser) -> dict[str, Any]:
    """環境設定(テーブル定義・Web フォーム・MCP トークン)を触れるのは管理者だけ(03 §5)。"""
    if not user.get("admin"):
        raise forbidden()
    return user


Admin = Annotated[dict[str, Any], Depends(require_admin)]
