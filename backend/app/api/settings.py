"""環境設定(04 §10)。テーブル定義と同じく**管理者だけ**(03 §5)。受け口だけは認証なし。"""

from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import Admin, Conn
from app.errors import ApiError
from app.meta.tables import web_forms
from app.settings import forms as form_service
from app.settings import service

router = APIRouter()


class TokenBody(BaseModel):
    name: str
    client: str = "other"


@router.get("/settings/mcp/tokens")
def list_tokens(conn: Conn, admin: Admin) -> list[dict[str, Any]]:
    return service.list_tokens(conn)


@router.post("/settings/mcp/tokens")
def create_token(body: TokenBody, conn: Conn, admin: Admin) -> dict[str, Any]:
    return service.create_token(conn, body.name, body.client, admin["id"])


@router.delete("/settings/mcp/tokens/{token_id}", status_code=204)
def revoke_token(token_id: str, conn: Conn, admin: Admin) -> None:
    service.revoke_token(conn, token_id)


@router.get("/settings/forms")
def list_forms(conn: Conn, admin: Admin) -> list[dict[str, Any]]:
    return service.list_forms(conn)


@router.post("/settings/forms")
def create_form(body: dict[str, Any], conn: Conn, admin: Admin) -> dict[str, Any]:
    return service.create_form(conn, body)


@router.put("/settings/forms/{form_id}")
def update_form(form_id: str, body: dict[str, Any], conn: Conn, admin: Admin) -> dict[str, Any]:
    return service.update_form(conn, form_id, body)


@router.delete("/settings/forms/{form_id}", status_code=204)
def delete_form(form_id: str, conn: Conn, admin: Admin) -> None:
    service.delete_form(conn, form_id)


@router.post("/settings/forms/{form_id}/rotate")
def rotate_key(form_id: str, conn: Conn, admin: Admin) -> dict[str, Any]:
    return service.rotate_key(conn, form_id)


async def _values(request: Request) -> dict[str, Any]:
    """本文は form-urlencoded か JSON。HTML のフォームからは前者で届く。"""
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("application/json"):
        body = await request.json()
        return dict(body) if isinstance(body, dict) else {}
    return dict(await request.form())


def _wants_html(request: Request) -> bool:
    accept = request.headers.get("accept", "")
    return "text/html" in accept and "application/json" not in accept


@router.post("/forms/{key}")
async def submit_form(key: str, request: Request, conn: Conn) -> Response:
    """**認証なしの受け口**。ここだけは外(Web サイト)から直に届く。"""
    values = await _values(request)
    source = request.client.host if request.client else "unknown"
    try:
        created = form_service.submit(conn, key, values, source)
    except ApiError as exc:
        if _wants_html(request) and exc.status == 404:
            return HTMLResponse(_page("受け付けられませんでした", "このフォームは使えません。"), status_code=404)
        raise
    if created is None:
        # bot 避け: 成功に見せる(04 §10 の 3)
        if _wants_html(request):
            return HTMLResponse(_page("送信しました", "ありがとうございました。"))
        return JSONResponse(_blank_record())
    if _wants_html(request):
        row = conn.execute(select(web_forms.c.redirect_url).where(web_forms.c.key == key)).first()
        if row is not None and row.redirect_url:
            return RedirectResponse(row.redirect_url, status_code=303)
        return HTMLResponse(_page("送信しました", "ありがとうございました。"))
    return JSONResponse(created)


def _blank_record() -> dict[str, Any]:
    from datetime import UTC, datetime
    from uuid import uuid4

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    return {"record": {"id": str(uuid4()), "created_at": now, "updated_at": now}, "references": {}}


def _page(title: str, message: str) -> str:
    return (
        "<!doctype html><html lang='ja'><meta charset='utf-8'>"
        f"<title>{title}</title>"
        "<body style='font-family:system-ui;margin:4rem auto;max-width:32rem;text-align:center'>"
        f"<h1 style='font-size:1.25rem'>{title}</h1><p>{message}</p></body></html>"
    )
