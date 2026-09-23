"""OAuth 2.0(認可コード + PKCE)。利用者が一度 Google で許可し、サーバが refresh token を持つ(04 §8)。

**state は署名だけで持つ**(DB にも Cookie にも置かない)。中身は「利用者の ID + 発行時刻 + 使い捨ての値」で、
PKCE の verifier も使い捨ての値から同じ鍵で導く。だから途中の状態を保存しなくても、戻ってきた要求が
自分の出したものだと確かめられる。
"""

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from app.config import get_settings
from app.errors import bad_request
from app.google import http
from app.security import app_secret

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"

# 参照(マイドライブを名前で探す)に readonly、新規作成に drive.file、繋いだアドレスの表示に email。
# readonly は制限付きスコープだが、OAuth アプリを**内部**(Workspace 限定)で公開する限り審査は要らない
SCOPES = (
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
)

# 許可の画面を開いてから戻ってくるまでの猶予
STATE_MAX_AGE = 15 * 60


def _mac(message: str) -> str:
    return hmac.new(app_secret().encode(), message.encode(), hashlib.sha256).hexdigest()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def make_state(user_id: str) -> str:
    body = f"{user_id}|{int(time.time())}|{secrets.token_hex(8)}"
    return f"{body}|{_mac(body)}"


def read_state(state: str, *, now: float | None = None) -> str:
    """state から利用者の ID を取り出す。偽物・古すぎるものは 400。"""
    parts = state.split("|")
    if len(parts) != 4:
        raise bad_request("戻り先の照合に失敗しました。もう一度お試しください", "invalid_state")
    user_id, issued, nonce, mac = parts
    if not hmac.compare_digest(_mac(f"{user_id}|{issued}|{nonce}"), mac):
        raise bad_request("戻り先の照合に失敗しました。もう一度お試しください", "invalid_state")
    if (now or time.time()) - int(issued) > STATE_MAX_AGE:
        raise bad_request("時間が経ちすぎました。もう一度お試しください", "invalid_state")
    return user_id


def verifier_of(state: str) -> str:
    """PKCE の verifier。state と同じ鍵から導くので、途中で保存しなくてよい。"""
    return _b64(hmac.new(app_secret().encode(), f"pkce|{state}".encode(), hashlib.sha256).digest())


def authorize_url(user_id: str) -> str:
    from urllib.parse import urlencode

    settings = get_settings()
    state = make_state(user_id)
    challenge = _b64(hashlib.sha256(verifier_of(state).encode()).digest())
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        # refresh token は「オフライン + 同意を出し直す」ときだけ返る
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def exchange_code(code: str, state: str) -> dict[str, Any]:
    settings = get_settings()
    return http.call(
        "POST",
        TOKEN_URL,
        data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": settings.google_redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": verifier_of(state),
        },
    )


def refresh_access_token(refresh_token: str) -> dict[str, Any]:
    settings = get_settings()
    return http.call(
        "POST",
        TOKEN_URL,
        data={
            "refresh_token": refresh_token,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "grant_type": "refresh_token",
        },
    )


def revoke(token: str) -> None:
    """許可を Google 側でも取り消す。失敗しても解除は続ける(こちらの行は消す)。"""
    import contextlib

    from app.errors import ApiError

    with contextlib.suppress(ApiError):
        http.call("POST", REVOKE_URL, data={"token": token})


def email_of(payload: dict[str, Any]) -> str:
    """token の応答に入っている id_token からアドレスを読む。

    署名は確かめない。**Google の token 端点から TLS で直に受け取った値**で、
    誰かに渡されたものではないため(OpenID Connect の仕様でもこの経路は検証不要)。
    """
    id_token = payload.get("id_token")
    if not isinstance(id_token, str) or id_token.count(".") != 2:
        return ""
    body = id_token.split(".")[1]
    try:
        claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except (ValueError, json.JSONDecodeError):
        return ""
    email = claims.get("email")
    return str(email) if isinstance(email, str) else ""
