"""署名と暗号化の鍵。

ログインの Cookie は `app/auth/sessions.py`(署名はせず、DB の行が正)。
"""

import secrets

from app.config import get_settings

_runtime_secret = secrets.token_hex(32)


def app_secret() -> str:
    """署名と暗号化の元になる鍵(`.env` の `WORKS_SECRET_KEY`)。

    .env に無ければ起動ごとのランダム(再起動で Google・Slack の繋ぎ直しと、2 段階認証のやり直しが要る)。
    """
    return get_settings().secret_key or _runtime_secret
