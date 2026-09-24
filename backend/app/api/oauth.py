"""MCP の接続を許可する画面(`/oauth/consent`)の API(04 §13)。

画面は Access の内側なので、ここに来るのは Access でログインした人だけ。許可すると、その人として MCP が使える。
"""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import Conn, CurrentUser
from app.mcpserver import oauth

router = APIRouter()


class Decision(BaseModel):
    approve: bool


@router.get("/oauth/requests/{request_id}")
def read_request(request_id: str, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    return oauth.pending_request(conn, request_id)


@router.post("/oauth/requests/{request_id}")
def decide(request_id: str, body: Decision, conn: Conn, user: CurrentUser) -> dict[str, str]:
    return {"redirect_url": oauth.decide(conn, request_id, user["id"], body.approve)}
