"""Google ドライブ(04 §8)。繋ぐ・外す・探す・作るの 4 つ。**画面はトークンに触れない**。"""

from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter
from fastapi.responses import RedirectResponse

from app.api.deps import Conn, CurrentUser
from app.config import get_settings
from app.errors import ApiError
from app.google import service, store

router = APIRouter()


@router.get("/google/status")
def google_status(conn: Conn, user: CurrentUser) -> dict[str, Any]:
    """繋いでいるかどうか。`configured` が false なら管理者が `.env` を入れていない。"""
    return {**store.status(conn, user["id"]), "configured": get_settings().google_enabled}


@router.post("/google/connect")
def google_connect(user: CurrentUser) -> dict[str, str]:
    """許可の画面の URL を返す。画面はこれを開くだけ(トークンのやり取りはサーバの中)。"""
    return service.connect_url(user["id"])


def _back(result: str) -> RedirectResponse:
    """画面へ戻す。行き先は**同じオリジンの中**だけ(`/` から始まる道)。"""
    path = get_settings().google_return_path
    if not path.startswith("/"):
        path = "/"
    # 303 は「POST のあとでも GET で開き直す」ための符号。Google からは GET で戻るが、意味を揃えておく
    return RedirectResponse(f"{path}?{urlencode({'google': result})}", status_code=303)


@router.get("/google/callback")
def google_callback(
    conn: Conn, code: str | None = None, state: str | None = None, error: str | None = None
) -> RedirectResponse:
    """Google からの戻り。**ここだけはログインの Cookie を見ない**(誰の許可かは署名付きの `state` が持つ)。"""
    if error or not code or not state:
        return _back("denied" if error == "access_denied" else "error")
    try:
        service.complete(conn, code, state)
    except ApiError:
        return _back("error")
    return _back("connected")


@router.delete("/google/connection", status_code=204)
def google_disconnect(conn: Conn, user: CurrentUser) -> None:
    """繋ぎを外す。Google 側の許可も取り消す。**ドライブのファイルは消さない**。"""
    store.disconnect(conn, user["id"])


@router.get("/drive/files")
def list_drive_files(conn: Conn, user: CurrentUser, q: str = "") -> list[dict[str, str]]:
    return service.list_files(conn, user["id"], q)


@router.post("/objects/{object_key}/records/{record_id}/drive/{field_key}/document")
def create_drive_document(
    object_key: str, record_id: str, field_key: str, conn: Conn, user: CurrentUser
) -> dict[str, Any]:
    return service.create_document(conn, user["id"], object_key, record_id, field_key)
