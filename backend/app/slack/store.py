"""Slack のチャンネルの置き場(`slack_connections`)。**1 行 = 1 チャンネル**で、いくつでも繋げる(04 §14)。

**Webhook の URL は暗号化して持つ**(鍵は `.env` の `WORKS_SECRET_KEY` から導く。Google と同じ)。
Webhook の URL は、知っていれば誰でもそのチャンネルに投稿できる鍵そのもの。DB の吸い出しだけでは使えないようにする。
**ボットトークンは持たない。**認可の応答に入っているが、使い道(アプリを外す `apps.uninstall`)を持たないので捨てる。
"""

import base64
import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Connection, delete, select
from sqlalchemy.dialects.postgresql import insert

from app.config import get_settings
from app.meta.tables import slack_connections, workflows
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


def valid_id(value: object) -> str | None:
    """UUID の形なら文字列で。違えば None(そのまま DB に渡すと型の不一致で落ちる)。"""
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        return None


def _iso(value: datetime | None) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


def _channel_dict(row: Any) -> dict[str, Any]:
    """画面に出すチャンネル(`SlackChannel`)。URL とトークンは出さない。"""
    return {
        "id": str(row.id),
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


def channels(conn: Connection) -> list[dict[str, Any]]:
    rows = conn.execute(select(slack_connections).order_by(slack_connections.c.created_at))
    return [_channel_dict(row) for row in rows]


def channel(conn: Connection, channel_id: str) -> dict[str, Any] | None:
    found = valid_id(channel_id)
    if found is None:
        return None
    row = conn.execute(select(slack_connections).where(slack_connections.c.id == found)).first()
    return _channel_dict(row) if row is not None else None


def status(conn: Connection) -> dict[str, Any]:
    """`SlackStatus`。`configured` が false なら、管理者が `.env` に資格情報を入れていない。"""
    return {"configured": get_settings().slack_enabled, "channels": channels(conn)}


@dataclass(frozen=True)
class Target:
    """送り先。`webhook_url` が None なら、保存した鍵を読めない(繋ぎ直しが要る)。"""

    id: str
    channel_name: str
    webhook_url: str | None


def target(conn: Connection, channel_id: str) -> Target | None:
    found = valid_id(channel_id)
    if found is None:
        return None
    row = conn.execute(select(slack_connections).where(slack_connections.c.id == found)).first()
    if row is None:
        return None
    return Target(str(row.id), row.channel_name, decrypt(row.webhook_url))


def upsert(conn: Connection, values: dict[str, Any], user_id: str) -> str:
    """許可で得たチャンネルを仕舞い、その id を返す。

    同じチャンネル(ワークスペースとチャンネルの組)を許可し直したら、その行の Webhook を差し替える(行は増やさない。
    ワークフローはこの行の id で指しているので、繋ぎ直しても選び直さなくてよい)。前の Webhook は Slack 側に残る。
    """
    row = insert(slack_connections).values(
        webhook_url=encrypt(values["webhook_url"]),
        team_id=values["team_id"],
        team_name=values["team_name"],
        channel_id=values["channel_id"],
        channel_name=values["channel_name"],
        configuration_url=values.get("configuration_url"),
        connected_by=user_id,
    )
    stmt = row.on_conflict_do_update(
        constraint="slack_connections_channel",
        set_={
            "webhook_url": row.excluded.webhook_url,
            "team_name": row.excluded.team_name,
            "channel_name": row.excluded.channel_name,
            "configuration_url": row.excluded.configuration_url,
            "connected_by": row.excluded.connected_by,
            # 繋ぎ直したので、前の失敗(要再接続)は消す
            "last_error": None,
            "last_error_code": None,
            "last_error_at": None,
        },
    ).returning(slack_connections.c.id)
    return str(conn.execute(stmt).scalar_one())


def used_by(conn: Connection, channel_id: str) -> list[str]:
    """そのチャンネルへ送るワークフローの名前(削除中のものは数えない)。"""
    rows = conn.execute(
        select(workflows.c.name, workflows.c.actions)
        .where(workflows.c.deleted_at.is_(None))
        .order_by(workflows.c.created_at)
    )
    return [
        row.name
        for row in rows
        if any(a.get("type") == "slack" and a.get("channel") == channel_id for a in row.actions or [])
    ]


def remove(conn: Connection, channel_id: str) -> bool:
    found = valid_id(channel_id)
    if found is None:
        return False
    return conn.execute(delete(slack_connections).where(slack_connections.c.id == found)).rowcount > 0


def record(conn: Connection, channel_id: str, *, error: str | None, code: str | None) -> None:
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
    conn.execute(slack_connections.update().where(slack_connections.c.id == channel_id).values(**values))
