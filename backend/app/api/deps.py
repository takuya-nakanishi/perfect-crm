"""FastAPI の依存。いまログインしている利用者を決める。"""

from typing import Annotated, Any

from fastapi import Depends, Request
from sqlalchemy import Connection, select

from app.db import connection
from app.errors import forbidden, unauthorized
from app.meta.tables import users
from app.security import COOKIE_NAME, verify

Conn = Annotated[Connection, Depends(connection)]


def current_user(request: Request, conn: Conn) -> dict[str, Any]:
    user_id = verify(request.cookies.get(COOKIE_NAME))
    if not user_id:
        raise unauthorized()
    row = conn.execute(select(users).where(users.c.id == user_id, users.c.deleted_at.is_(None))).first()
    if row is None:
        raise unauthorized()
    user: dict[str, Any] = {
        "id": str(row.id),
        "name": row.name,
        "email": row.email,
        "avatar_color": row.avatar_color,
    }
    if row.admin:
        user["admin"] = True
    return user


CurrentUser = Annotated[dict[str, Any], Depends(current_user)]


def require_admin(user: CurrentUser) -> dict[str, Any]:
    """環境設定(テーブル定義・Web フォーム・MCP トークン)を触れるのは管理者だけ(03 §5)。"""
    if not user.get("admin"):
        raise forbidden()
    return user


Admin = Annotated[dict[str, Any], Depends(require_admin)]
