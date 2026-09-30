"""アクション「Slack に知らせる」(04 §15)。選んだチャンネル(`slack_connections` の行)へ、レコードの内容を送る。

本文は実行記録を入れるとき(書き込みと同じトランザクション)に作る。送るのは送り係で、チャンネルの Webhook は
送る直前に読む(繋ぎ直して Webhook が替わっていても、新しい方へ届く)。
"""

from typing import Any

from sqlalchemy import Connection

from app import db
from app.errors import bad_request
from app.meta import store as meta_store
from app.slack import message
from app.slack import service as slack_service
from app.slack import store as slack_store
from app.workflows.actions import Firing, Result

# 載せる項目の上限(Slack の本文が長くなりすぎない)
MAX_FIELDS = 20


class SlackKind:
    def check(self, conn: Connection, obj: dict[str, Any], action: dict[str, Any]) -> dict[str, Any]:
        channel = action.get("channel")
        if not isinstance(channel, str) or slack_store.channel(conn, channel) is None:
            raise bad_request("「Slack に知らせる」のチャンネルを選んでください")
        raw = action.get("fields") or []
        if not isinstance(raw, list):
            raise bad_request("載せる項目は列名の並びで指定してください")
        known = {f["key"] for f in obj["fields"]}
        fields: list[str] = []
        for key in raw:
            if not isinstance(key, str) or key not in known:
                raise bad_request(f"載せる項目が {obj['label']} にありません: {key!r}")
            if key not in fields:
                fields.append(key)
        if len(fields) > MAX_FIELDS:
            raise bad_request(f"載せる項目は {MAX_FIELDS} 個までです")
        return {"id": action["id"], "type": "slack", "channel": slack_store.valid_id(channel), "fields": fields}

    def prepare(self, conn: Connection, firing: Firing, action: dict[str, Any]) -> dict[str, Any]:
        actor_name = None
        if firing.origin.actor:
            found = next((u for u in meta_store.all_users(conn) if u["id"] == firing.origin.actor), None)
            actor_name = found["name"] if found else None
        body = message.workflow_notice(
            conn,
            title=firing.workflow_name,
            obj=firing.obj,
            record=firing.record,
            fields=list(action.get("fields") or []),
            event=firing.event,
            origin=firing.origin,
            actor_name=actor_name,
            test=firing.test,
        )
        return {"channel": action.get("channel"), "message": body}

    def execute(self, payload: dict[str, Any]) -> Result:
        channel = str(payload.get("channel") or "")
        with db.transaction() as conn:
            target = slack_store.target(conn, channel)
        if target is None:
            return Result(
                "failed",
                "送り先のチャンネルが外されています。ワークフローのチャンネルを選び直してください",
                "channel_removed",
            )
        outcome = slack_service.post_once(target, payload["message"])
        with db.transaction() as conn:
            slack_store.record(conn, target.id, error=outcome.error, code=outcome.code)
        if outcome.sent:
            return Result("done")
        if outcome.transient:
            return Result("retry", outcome.error, outcome.code, outcome.retry_after)
        return Result("failed", outcome.error, outcome.code)

    def target(self, conn: Connection, payload: dict[str, Any]) -> str | None:
        found = slack_store.channel(conn, str(payload.get("channel") or ""))
        return found["channel_name"] if found else None

    def problems(self, conn: Connection, obj: dict[str, Any], action: dict[str, Any]) -> list[str]:
        found = slack_store.channel(conn, str(action.get("channel") or ""))
        if found is None:
            return ["「Slack に知らせる」のチャンネルが外されています"]
        if found["needs_reconnect"]:
            return [f"チャンネル {found['channel_name']} は要再接続です(環境設定の Slack から繋ぎ直してください)"]
        return []

    def pace_key(self, payload: dict[str, Any]) -> str | None:
        # Incoming Webhook は 1 チャンネルに毎秒 1 件まで
        return f"slack:{payload.get('channel')}"


KIND = SlackKind()
