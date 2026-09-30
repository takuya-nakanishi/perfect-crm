"""Slack の繋ぎ先の置き場(`slack_connections`)。ワークスペースに 1 行だけ。

**Webhook の URL は暗号化して持つ**(鍵は `.env` の `WORKS_SECRET_KEY` から導く。Google と同じ)。
Webhook の URL は、知っていれば誰でもそのチャンネルに投稿できる鍵そのもの。DB の吸い出しだけでは使えないようにする。
**ボットトークンは持たない。**認可の応答に入っているが、使い道(アプリを外す `apps.uninstall`)を持たないので捨てる。
"""

import base64
import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Connection, delete, select

from app.config import get_settings
from app.meta.tables import slack_connections
from app.security import app_secret

# 送れなくなった(繋ぎ直すまで届かない)ことを示すコード。Incoming Webhook のエラー(docs.slack.dev の
# 「Sending messages using incoming webhooks」)と、保存した鍵を読めないとき(`WORKS_SECRET_KEY` が変わった)
RECONNECT_CODES = frozenset(
    {
        "no_service",
        "no_active_hooks",
        "no_service_id",
        "channel_not_found",
        "channel_is_archived",
        "action_prohibited",
        "posting_to_general_channel_denied",
        "no_team",
        "team_disabled",
        "invalid_token",
        "undecryptable",
    }
)


def _cipher() -> Fernet:
    key = hashlib.sha256(f"slack-token|{app_secret()}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt(value: str) -> str:
    return _cipher().encrypt(value.encode()).decode()


def decrypt(value: str) -> str | None:
    """鍵が変わっていれば読めない(None)。その場合は繋ぎ直してもらう。"""
    try:
        return _cipher().decrypt(value.encode()).decode()
    except InvalidToken:
        return None


def _iso(value: datetime | None) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


def _row(conn: Connection) -> Any:
    return conn.execute(select(slack_connections).order_by(slack_connections.c.created_at.desc()).limit(1)).first()


def status(conn: Connection) -> dict[str, Any]:
    """画面に出す繋がり具合(`SlackStatus`)。URL とトークンは出さない。"""
    row = _row(conn)
    connection = None
    if row is not None:
        connection = {
            "team_name": row.team_name,
            "channel_name": row.channel_name,
            "configuration_url": row.configuration_url,
            "connected_by": str(row.connected_by) if row.connected_by else None,
            "connected_at": _iso(row.created_at),
            "last_sent_at": _iso(row.last_sent_at),
            "last_error": row.last_error,
            "last_error_at": _iso(row.last_error_at),
            "needs_reconnect": row.last_error_code in RECONNECT_CODES,
        }
    return {"configured": get_settings().slack_enabled, "connection": connection}


def connected(conn: Connection) -> bool:
    return conn.execute(select(slack_connections.c.id).limit(1)).first() is not None


@dataclass(frozen=True)
class Target:
    """送り先。`webhook_url` が None なら、保存した鍵を読めない(繋ぎ直しが要る)。"""

    id: str
    channel_name: str
    webhook_url: str | None


def target(conn: Connection) -> Target | None:
    row = _row(conn)
    if row is None:
        return None
    return Target(str(row.id), row.channel_name, decrypt(row.webhook_url))


def replace(conn: Connection, values: dict[str, Any], user_id: str) -> None:
    """繋ぎ直しは置き換え(ワークスペースで 1 つ)。前の Webhook は Slack 側に残る(送るのは新しい方だけ)。"""
    conn.execute(delete(slack_connections))
    conn.execute(
        slack_connections.insert().values(
            webhook_url=encrypt(values["webhook_url"]),
            team_id=values["team_id"],
            team_name=values["team_name"],
            channel_id=values["channel_id"],
            channel_name=values["channel_name"],
            configuration_url=values.get("configuration_url"),
            connected_by=user_id,
        )
    )


def remove(conn: Connection) -> None:
    conn.execute(delete(slack_connections))


def record(conn: Connection, connection_id: str, *, error: str | None, code: str | None) -> None:
    """送った結果を残す。送れたら前の失敗を消す(画面の「要再接続」も消える)。"""
    now = datetime.now(UTC)
    if error is None:
        values: dict[str, Any] = {
            "last_sent_at": now,
            "last_error": None,
            "last_error_code": None,
            "last_error_at": None,
        }
    else:
        values = {"last_error": error, "last_error_code": code, "last_error_at": now}
    conn.execute(slack_connections.update().where(slack_connections.c.id == connection_id).values(**values))
