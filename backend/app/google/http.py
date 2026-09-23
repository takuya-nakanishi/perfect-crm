"""Google の API を叩く**1 本の口**。テストはこの `call` だけを差し替える(本物へは繋がない)。

失敗は全部ここで `ApiError` に訳す。呼ぶ側は HTTP の詳細を知らない。
"""

from typing import Any

import httpx2

from app.errors import ApiError

TIMEOUT = 15.0


def reauth_needed(message: str = "Google の接続が切れました。もう一度繋いでください") -> ApiError:
    """許可が取り消された・鍵が変わった。画面は「Google に接続」を出し直す。"""
    return ApiError(409, "google_reauth", message)


def _message(res: httpx2.Response) -> str:
    """Google のエラーの本文から、人に見せる 1 行を取り出す。"""
    try:
        body = res.json()
    except ValueError:
        return res.text[:200]
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict):
        text = error.get("message") or error.get("status") or ""
        return str(text)[:200]
    if isinstance(error, str):
        # OAuth のエラーは {"error": "invalid_grant", "error_description": "..."} の形
        detail = body.get("error_description") or ""
        return f"{error}{f': {detail}' if detail else ''}"[:200]
    return res.text[:200]


def call(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    params: dict[str, Any] | None = None,
    json: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        with httpx2.Client(timeout=TIMEOUT) as client:
            res = client.request(method, url, headers=headers, params=params, json=json, data=data)
    except httpx2.HTTPError as exc:  # 名前が引けない・繋がらない・時間切れ
        raise ApiError(
            502, "google_unavailable", "Google に繋がりませんでした。少し待ってからもう一度お試しください"
        ) from exc

    # 401 は鍵切れ、403 の「権限が足りない」は許可の取り消し・スコープ変更。どちらも繋ぎ直しで直る
    if res.status_code == 401 or (res.status_code == 403 and "insufficient" in _message(res).lower()):
        raise reauth_needed()
    if res.status_code >= 400:
        raise ApiError(502, "google_error", f"Google の応答が {res.status_code} でした({_message(res)})")
    if not res.content:
        return {}
    body: Any = res.json()
    return body if isinstance(body, dict) else {"items": body}
