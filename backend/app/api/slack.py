"""Slack のチャンネル(04 §14)。繋ぐ・一覧・テスト通知・外すは**管理者だけ**(ワークスペース全体の設定。03 §5)。"""

from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.api.deps import Admin, Conn
from app.errors import ApiError
from app.slack import service, store

router = APIRouter()


class ConnectBody(BaseModel):
    # 許可のあとに戻す画面(環境設定の中だけ。違えば環境設定の Slack)
    return_to: str | None = None


@router.get("/settings/slack")
def slack_status(conn: Conn, admin: Admin) -> dict[str, Any]:
    """繋いでいるチャンネル。`configured` が false なら管理者が `.env` を入れていない。"""
    return store.status(conn)


@router.post("/settings/slack/connect")
def slack_connect(admin: Admin, body: ConnectBody | None = None) -> dict[str, str]:
    """Slack の許可の画面の URL を返す。チャンネルはそこで選ぶ。画面はこれを開くだけ。"""
    return {"url": service.authorize_url(admin["id"], body.return_to if body else None)}


def _back(path: str, **query: str) -> RedirectResponse:
    return RedirectResponse(f"{path}?{urlencode(query)}", status_code=303)


@router.get("/slack/callback")
def slack_callback(
    conn: Conn, code: str | None = None, state: str | None = None, error: str | None = None
) -> RedirectResponse:
    """Slack からの戻り。誰の許可か・どこへ戻すかは署名付きの `state` が持つ(Google の戻りと同じ)。

    state を読めないときは、戻り先も信じられないので環境設定の Slack へ戻す。
    """
    try:
        parsed = service.read_state(state or "")
    except ApiError:
        return _back(service.DEFAULT_RETURN, slack="denied" if error == "access_denied" else "error")
    if error or not code:
        return _back(parsed.return_to, slack="denied" if error == "access_denied" else "error")
    try:
        channel_id = service.complete(conn, code, parsed)
    except ApiError:
        return _back(parsed.return_to, slack="error")
    return _back(parsed.return_to, slack="connected", channel=channel_id)


@router.post("/settings/slack/{channel_id}/test")
def slack_test(channel_id: str, conn: Conn, admin: Admin) -> dict[str, Any]:
    """テスト通知を送り、結果を記録した状態を返す(送れたかは、そのチャンネルの `last_error` が空か)。"""
    service.send_test(conn, channel_id)
    return store.status(conn)


@router.delete("/settings/slack/{channel_id}", status_code=204)
def slack_disconnect(channel_id: str, conn: Conn, admin: Admin) -> None:
    """チャンネルを外す。Works が Webhook を捨てるだけで、Slack のアプリは外さない(ほかの仕組みと共有しているため)。

    ワークフローが送り先に選んでいるあいだは 409 `channel_in_use`。
    """
    service.disconnect(conn, channel_id)
