"""Slack への通知(04 §14)。繋ぐ・状態・テスト通知・外すは**管理者だけ**(ワークスペース全体の設定。03 §5)。"""

from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter
from fastapi.responses import RedirectResponse

from app.api.deps import Admin, Conn
from app.errors import ApiError
from app.slack import service, store

router = APIRouter()

# 戻したあとに開く画面(環境設定の「通知」)
RETURN_PATH = "/settings/notifications"


@router.get("/settings/slack")
def slack_status(conn: Conn, admin: Admin) -> dict[str, Any]:
    """繋いでいるか。`configured` が false なら管理者が `.env` を入れていない。"""
    return store.status(conn)


@router.post("/settings/slack/connect")
def slack_connect(admin: Admin) -> dict[str, str]:
    """Slack の許可の画面の URL を返す。チャンネルはそこで選ぶ。画面はこれを開くだけ。"""
    return {"url": service.authorize_url(admin["id"])}


def _back(result: str) -> RedirectResponse:
    return RedirectResponse(f"{RETURN_PATH}?{urlencode({'slack': result})}", status_code=303)


@router.get("/slack/callback")
def slack_callback(
    conn: Conn, code: str | None = None, state: str | None = None, error: str | None = None
) -> RedirectResponse:
    """Slack からの戻り。誰の許可かは署名付きの `state` が持つ(Google の戻りと同じ)。"""
    if error or not code or not state:
        return _back("denied" if error == "access_denied" else "error")
    try:
        service.complete(conn, code, state)
    except ApiError:
        return _back("error")
    return _back("connected")


@router.post("/settings/slack/test")
def slack_test(conn: Conn, admin: Admin) -> dict[str, Any]:
    """テスト通知を送り、結果を記録した状態を返す(送れたかは `connection.last_error` が空か)。"""
    service.send_test(conn)
    return store.status(conn)


@router.delete("/settings/slack", status_code=204)
def slack_disconnect(conn: Conn, admin: Admin) -> None:
    """連携を解除する。Slack のワークスペースからもアプリを外す。"""
    service.disconnect(conn)
