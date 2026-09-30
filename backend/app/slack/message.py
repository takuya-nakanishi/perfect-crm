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
from app.records.origin import Origin

# Slack のブロックの上限(header は 150 字・section の text は 3000 字・field は 2000 字・section の fields は 10 個)より
# 内側で切る
MAX_HEADER = 140
MAX_SECTION = 2900
MAX_FIELD = 1900
FIELDS_PER_SECTION = 10
# 横に並べると読みにくい長い文は、1 段ぶん使う
LONG_TYPES = frozenset({"textarea", "richtext"})

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


# どこからの書き込みか(本文の末尾に添える)
ORIGIN_LABELS = {
    "app": "画面",
    "form": "Web フォーム",
    "mcp": "AI(MCP)",
    "auto": "自動作成",
    "import": "CSV の取り込み",
}


def origin_text(origin: Origin, actor_name: str | None) -> str:
    """「Web フォーム「お問い合わせ」」「Takuya(画面)」のように。"""
    where = ORIGIN_LABELS.get(origin.kind, origin.kind)
    if origin.kind == "form" and origin.label:
        where = f"Web フォーム「{origin.label}」"
    return f"{actor_name}({where})" if actor_name else where


def record_name(obj: dict[str, Any], record: dict[str, Any] | None) -> str:
    if record is None:
        return "(見本のレコード)"
    return str(record.get(obj["name_field"]) or "").strip() or "(名前なし)"


def workflow_notice(
    conn: Connection,
    *,
    title: str,
    obj: dict[str, Any],
    record: dict[str, Any] | None,
    fields: list[str],
    event: str,
    origin: Origin,
    actor_name: str | None,
    test: bool = False,
) -> dict[str, Any]:
    """ワークフローの「Slack に知らせる」の本文。

    見出しはワークフローの名前。続けてレコードの表示名、選んだ項目(空の値は載せない。表示名の項目は重ねない)、
    末尾に「何が起きたか · どこからか · Works で開く」。レコードが無い(テスト送信でテーブルが空)ときは見本の値で作る。
    """
    timezone = store.get_workspace(conn)["timezone"]
    by_key = {f["key"]: f for f in obj["fields"]}
    short: list[dict[str, str]] = []
    long: list[dict[str, Any]] = []
    for key in fields:
        field = by_key.get(key)
        if field is None or key == obj["name_field"]:
            continue
        value = f"({field['label']})" if record is None else _value(conn, obj, field, record, timezone)
        if not value:
            continue
        if field["type"] in LONG_TYPES:
            long.append(
                {"type": "section", "text": {"type": "mrkdwn", "text": _entry(field["label"], value, MAX_SECTION)}}
            )
        else:
            short.append({"type": "mrkdwn", "text": _entry(field["label"], value, MAX_FIELD)})

    name = record_name(obj, record)
    heading = f"[テスト] {title}" if test else title
    blocks: list[dict[str, Any]] = [
        {"type": "header", "text": {"type": "plain_text", "text": truncate(heading, MAX_HEADER), "emoji": True}},
        {"type": "section", "text": {"type": "mrkdwn", "text": truncate(f"*{escape(name)}*", MAX_SECTION)}},
    ]
    for i in range(0, len(short), FIELDS_PER_SECTION):
        blocks.append({"type": "section", "fields": short[i : i + FIELDS_PER_SECTION]})
    blocks.extend(long)

    what = f"{obj['label']}に作成" if event == "created" else f"{obj['label']}が条件を満たしました"
    parts = [escape(what), escape(origin_text(origin, actor_name))]
    if record is not None:
        record_id = str(record.get("id", ""))
        url = _url(f"/o/{obj['key']}?peek={obj['key']}:{record_id}")
        parts.append(f"<{url}|Works で開く>")
    blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": " · ".join(parts)}]})

    summary = f"[Works]{'[テスト]' if test else ''} {title}: {name}"
    return {"text": escape(truncate(summary, 300)), "blocks": blocks}


def test_message(channel_name: str) -> dict[str, Any]:
    where = f"このチャンネル({channel_name})" if channel_name else "このチャンネル"
    body = f"{where}に、ワークフローの「Slack に知らせる」の通知が届きます。"
    return {
        "text": "[Works] テスト通知",
        "blocks": [
            {"type": "header", "text": {"type": "plain_text", "text": TEST_TITLE, "emoji": True}},
            {"type": "section", "text": {"type": "mrkdwn", "text": escape(body)}},
            _link(_url("/settings/workflows"), "Works でワークフローを開く"),
        ],
    }
