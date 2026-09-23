"""メタデータの読み出し(04 §2 の `GET /meta`)。書き込み(§6)は J-033。"""

from typing import Any

from fastapi import APIRouter

from app.api.deps import Conn, CurrentUser
from app.meta import store

router = APIRouter()


@router.get("/meta")
def read_meta(conn: Conn, user: CurrentUser) -> dict[str, Any]:
    return store.meta_response(conn)
