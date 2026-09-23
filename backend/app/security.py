"""署名と暗号化の鍵、および `WORKS_AUTH=dev` のセッション Cookie。

本番のログインは Cloudflare Access の JWT(app/access.py。03 §5 の B 案)で、Cookie は使わない。
"""

import hmac
import secrets
from hashlib import sha256

from app.config import get_settings

COOKIE_NAME = "works_session"
# 30 日。画面を開きっぱなしで使うので長めに取る
COOKIE_MAX_AGE = 60 * 60 * 24 * 30

_runtime_secret = secrets.token_hex(32)


def app_secret() -> str:
    """署名と暗号化の元になる鍵(`.env` の `WORKS_SECRET_KEY`)。

    .env に無ければ起動ごとのランダム(再起動でログインし直しになり、Google の繋ぎ直しも要る)。
    """
    return get_settings().secret_key or _runtime_secret


def sign(user_id: str) -> str:
    mac = hmac.new(app_secret().encode(), user_id.encode(), sha256).hexdigest()
    return f"{user_id}.{mac}"


def verify(value: str | None) -> str | None:
    """Cookie の値から利用者の ID を取り出す。偽物・書き換えは None。"""
    if not value or "." not in value:
        return None
    user_id, _, mac = value.rpartition(".")
    return user_id if hmac.compare_digest(sign(user_id), f"{user_id}.{mac}") else None
