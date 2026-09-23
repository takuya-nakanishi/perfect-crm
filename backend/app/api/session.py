"""ログイン(04 §2 の `/session`)。パスワードの検証は J-023 で足す。"""

from typing import Any

from fastapi import APIRouter, Response
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import Conn, CurrentUser
from app.config import get_settings
from app.errors import unauthorized
from app.meta import store
from app.meta.tables import users
from app.security import COOKIE_MAX_AGE, COOKIE_NAME, sign

router = APIRouter()


class LoginBody(BaseModel):
    email: str
    # J-023 まで見ない(モックも「何を入れても通る」)
    password: str = ""


@router.get("/session")
def read_session(user: CurrentUser, conn: Conn) -> dict[str, Any]:
    return {"user": user, "workspace": store.get_workspace(conn)}


@router.post("/session")
def login(body: LoginBody, response: Response, conn: Conn) -> dict[str, Any]:
    row = conn.execute(
        select(users).where(users.c.email == body.email.strip().lower(), users.c.deleted_at.is_(None))
    ).first()
    if row is None:
        raise unauthorized("メールアドレスかパスワードが違います")
    response.set_cookie(
        COOKIE_NAME,
        sign(str(row.id)),
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=get_settings().secure_cookie,
        path="/",
    )
    user: dict[str, Any] = {"id": str(row.id), "name": row.name, "email": row.email, "avatar_color": row.avatar_color}
    if row.admin:
        user["admin"] = True
    return {"user": user, "workspace": store.get_workspace(conn)}


@router.delete("/session", status_code=204)
def logout(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")
