"""ログイン(04 §2 の `/session`)。

本番(`WORKS_AUTH=access`)は Cloudflare Access が門で、アプリはログイン画面を出さない(03 §5 の B 案)。
`POST /session` はメールアドレスだけで入れる `dev` のためのもの(Access の無い手元の E2E とテスト)。
"""

from typing import Any

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import Conn, CurrentUser, user_dict
from app.config import get_settings
from app.errors import ApiError, unauthorized
from app.meta import store
from app.meta.tables import users
from app.security import COOKIE_MAX_AGE, COOKIE_NAME, sign

router = APIRouter()

# Access のログアウト。Cloudflare の縁で受けるので、アプリには届かない
ACCESS_LOGOUT_URL = "/cdn-cgi/access/logout"


class LoginBody(BaseModel):
    email: str
    # 見ない(dev はメールアドレスだけで入れる。本番は Access が門)
    password: str = ""


@router.get("/session")
def read_session(user: CurrentUser, conn: Conn) -> dict[str, Any]:
    return {"user": user, "workspace": store.get_workspace(conn)}


@router.post("/session")
def login(body: LoginBody, response: Response, conn: Conn) -> dict[str, Any]:
    settings = get_settings()
    if settings.auth != "dev":
        raise ApiError(400, "access_login", "ログインは Cloudflare Access で行います")
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
        secure=settings.secure_cookie,
        path="/",
    )
    return {"user": user_dict(row), "workspace": store.get_workspace(conn)}


@router.delete("/session")
def logout() -> Response:
    if get_settings().auth == "access":
        # アプリは Cookie を持たないので、Access のセッションを切ってもらう(画面はこの URL へ移る)
        return JSONResponse({"logout_url": ACCESS_LOGOUT_URL})
    response = Response(status_code=204)
    response.delete_cookie(COOKIE_NAME, path="/")
    return response
