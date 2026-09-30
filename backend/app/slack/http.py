"""Slack を叩く**2 本の口**。テストはこの 2 つだけを差し替える(本物へは繋がない)。

- `api`: Web API(`https://slack.com/api/<メソッド>`)。認可コードの交換と、連携の解除(`apps.uninstall`)
- `webhook`: Incoming Webhook への投稿。応答は JSON ではなく文字(成功は 200 の `ok`、失敗は `no_service` などのコード)
"""

from dataclasses import dataclass
from typing import Any

import httpx2

from app.errors import ApiError

API_BASE = "https://slack.com/api/"
TIMEOUT = 10.0


@dataclass(frozen=True)
class WebhookResult:
    """投稿の結果。`status` が 0 なら繋がらなかった(名前が引けない・時間切れ)。"""

    status: int
    body: str = ""
    # 429 の Retry-After(秒)
    retry_after: float | None = None


def api(method: str, data: dict[str, str]) -> dict[str, Any]:
    """Web API を form-urlencoded で呼ぶ。失敗しても応答は `{"ok": false, "error": …}` の形で返るので、判定は呼ぶ側。"""
    try:
        with httpx2.Client(timeout=TIMEOUT) as client:
            res = client.post(API_BASE + method, data=data)
    except httpx2.HTTPError as exc:
        raise ApiError(
            502, "slack_unavailable", "Slack に繋がりませんでした。少し待ってからもう一度お試しください"
        ) from exc
    try:
        body: Any = res.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise ApiError(502, "slack_error", f"Slack の応答を読めませんでした(HTTP {res.status_code})")
    return body


def webhook(url: str, payload: dict[str, Any]) -> WebhookResult:
    try:
        with httpx2.Client(timeout=TIMEOUT) as client:
            res = client.post(url, json=payload)
    except httpx2.HTTPError:
        return WebhookResult(0)
    retry_after: float | None = None
    raw = res.headers.get("retry-after")
    if raw:
        try:
            retry_after = float(raw)
        except ValueError:
            retry_after = None
    return WebhookResult(res.status_code, res.text.strip()[:200], retry_after)
