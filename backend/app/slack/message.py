"""Slack へ送る本文(Block Kit)。`text` は通知や読み上げに使われる要約で必須、`blocks` が本文。

**人が書いた文字列は、Slack の書式の特殊文字 `&` `<` `>` をエスケープしてから載せる。**Web フォームは誰でも送れるので、
`<!channel>` でチャンネル全員に通知を飛ばしたり、`<https://…|…>` で偽のリンクを作ったりできないようにする。
リンクはボタンにせず mrkdwn のリンクにする — ボタンは押されると Slack がアプリの Interactivity の口へ知らせようとし、
Works はその口を持たない。
"""

import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import Connection

from app.config import get_settings
from app.meta import store
from app.records.csv_io import display_text

# Slack のブロックの上限(section の text は 3000 字・field は 2000 字・section の fields は 10 個)より内側で切る
MAX_SECTION = 2900
MAX_FIELD = 1900
FIELDS_PER_SECTION = 10
# 横に並べると読みにくい長い文は、1 段ぶん使う
LONG_TYPES = frozenset({"textarea", "richtext"})

FORM_TITLE = "📨 Web フォームから登録がありました"
TEST_TITLE = "✅ Works からのテスト通知です"

# 切った末尾に残った、途中までの `&amp;` など
_BROKEN_ENTITY = re.compile(r"&[a-z]*$")


def escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return _BROKEN_ENTITY.sub("", text[: limit - 1]) + "…"


def _url(path: str) -> str:
    return f"{get_settings().public_url.rstrip('/')}{path}"


def _link(url: str, label: str) -> dict[str, Any]:
    # URL は Works が組み立てたもの(テーブル名は英小文字と _、ID は UUID)で、`<` `>` `|` を含まない
    return {"type": "context", "elements": [{"type": "mrkdwn", "text": f"<{url}|{label}>"}]}


def _value(conn: Connection, obj: dict[str, Any], field: dict[str, Any], record: dict[str, Any], timezone: str) -> str:
    value = record.get(field["key"])
    if field["type"] == "datetime" and isinstance(value, str) and value:
        # 日時は UTC で持っている。ワークスペースの時刻で出す
        try:
            at = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
        return at.astimezone(ZoneInfo(timezone)).strftime("%Y-%m-%d %H:%M")
    return display_text(conn, obj, field, record).strip()


def _entry(label: str, value: str, limit: int) -> str:
    return truncate(f"*{escape(label)}*\n{escape(value)}", limit)


def form_submission(
    conn: Connection, form_name: str, object_key: str, fields: list[str], record: dict[str, Any]
) -> dict[str, Any]:
    """Web フォームで作ったレコードの知らせ。載せるのは**そのフォームが受け付けた項目**だけ(既定値は載せない)。"""
    obj = store.object_meta(conn, object_key)
    timezone = store.get_workspace(conn)["timezone"]
    by_key = {f["key"]: f for f in obj["fields"]}
    short: list[dict[str, str]] = []
    long: list[dict[str, Any]] = []
    for key in fields:
        field = by_key.get(key)
        if field is None:
            continue
        value = _value(conn, obj, field, record, timezone)
        if not value:
            continue
        if field["type"] in LONG_TYPES:
            long.append(
                {"type": "section", "text": {"type": "mrkdwn", "text": _entry(field["label"], value, MAX_SECTION)}}
            )
        else:
            short.append({"type": "mrkdwn", "text": _entry(field["label"], value, MAX_FIELD)})

    blocks: list[dict[str, Any]] = [
        {"type": "header", "text": {"type": "plain_text", "text": FORM_TITLE, "emoji": True}}
    ]
    for i in range(0, len(short), FIELDS_PER_SECTION):
        blocks.append({"type": "section", "fields": short[i : i + FIELDS_PER_SECTION]})
    blocks.extend(long)
    record_id = str(record.get("id", ""))
    url = _url(f"/o/{object_key}?peek={object_key}:{record_id}")
    where = escape(f"フォーム「{form_name}」から{obj['label']}に登録")
    blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": f"{where} · <{url}|Works で開く>"}]})

    name = str(record.get(obj["name_field"]) or "").strip() or "(名前なし)"
    summary = f"[Works] Web フォーム「{form_name}」: {name}"
    return {"text": escape(truncate(summary, 300)), "blocks": blocks}


def test_message(channel_name: str) -> dict[str, Any]:
    where = f"このチャンネル({channel_name})" if channel_name else "このチャンネル"
    body = f"{where}に、Web フォームから登録があったときの通知が届きます。"
    return {
        "text": "[Works] テスト通知",
        "blocks": [
            {"type": "header", "text": {"type": "plain_text", "text": TEST_TITLE, "emoji": True}},
            {"type": "section", "text": {"type": "mrkdwn", "text": escape(body)}},
            _link(_url("/settings/notifications"), "Works で通知の設定を開く"),
        ],
    }
