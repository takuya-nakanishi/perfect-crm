"""時系列(04 §9)。**サーバが 3 つを合成する**ので、画面はテーブルをまたぐ結合をしない。

- `activity`: 関連先がそのレコードの活動
- `mention`: 内容の `@` でそのレコードに言及した活動(`related` に本来の関連先を添える)
- `completion`: そのレコードに付いた、完了したタスク(活動には複製しない。02 §3)
"""

from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, or_, select

from app.meta import store
from app.meta.tables import activity_mentions
from app.records.refs import ref_of
from app.records.tables import table_of
from app.records.values import to_api

LIMIT = 100


def _paragraphs(text: str) -> str:
    """素の文字を段落にする(タスクの詳細を時系列に出すとき)。"""
    escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return "".join(f"<p>{line}</p>" for line in escaped.splitlines() if line.strip())


def _points_to(obj: dict[str, Any], row: dict[str, Any], object_key: str, record_id: str) -> bool:
    """その行が (テーブル, ID) を指しているか。関連先(polymorphic)と参照(relation)の両方を見る。"""
    for field in obj["fields"]:
        cols = field.get("columns")
        if field["type"] == "polymorphic" and cols:
            same = row.get(cols["object"]) == object_key and str(row.get(cols["id"]) or "") == record_id
        elif field["type"] == "relation" and field.get("target") == object_key:
            same = str(row.get(field["key"]) or "") == record_id
        else:
            continue
        if same:
            return True
    return False


def _local_date(value: Any, timezone: str) -> str:
    if isinstance(value, datetime):
        return value.astimezone(ZoneInfo(timezone)).date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value or "")[:10]


def timeline(conn: Connection, object_key: str, record_id: str) -> dict[str, Any]:
    store.object_meta(conn, object_key)  # 無いテーブルは 404
    timezone = store.get_workspace(conn)["timezone"]
    entries: list[dict[str, Any]] = []
    for obj in store.live_objects(conn):
        if obj.get("timeline"):
            entries += _activities(conn, obj, object_key, record_id, timezone)
        elif obj.get("completion") and obj["key"] != object_key:
            entries += _completions(conn, obj, object_key, record_id, timezone)
    # 日付の新しい順。同じ日なら記録した日時の新しい順
    entries.sort(key=lambda e: (e["date"], e["at"]), reverse=True)
    return {"entries": entries[:LIMIT]}


def _activities(
    conn: Connection, obj: dict[str, Any], object_key: str, record_id: str, timezone: str
) -> list[dict[str, Any]]:
    table = table_of(obj)
    spec = obj["timeline"]
    related_field = next((f for f in obj["fields"] if f["type"] == "polymorphic" and f.get("columns")), None)
    user_field = next((f for f in obj["fields"] if f["type"] == "user"), None)
    type_field = next((f for f in obj["fields"] if f["key"] == spec["type"]), None)

    mentioned = select(activity_mentions.c.activity_id).where(
        activity_mentions.c.object_key == object_key, activity_mentions.c.record_id == record_id
    )
    where: list[Any] = [table.c.deleted_at.is_(None)]
    if related_field:
        cols = related_field["columns"]
        where.append(
            or_(
                (table.c[cols["object"]] == object_key) & (table.c[cols["id"]] == record_id),
                table.c.id.in_(mentioned),
            )
        )
    else:
        where.append(table.c.id.in_(mentioned))

    out: list[dict[str, Any]] = []
    rows = [dict(row._mapping) for row in conn.execute(select(table).where(*where))]
    names = _names(conn, rows, related_field)
    for row in rows:
        direct = _points_to(obj, row, object_key, record_id)
        related = None
        if related_field:
            cols = related_field["columns"]
            target, target_id = row.get(cols["object"]), row.get(cols["id"])
            if isinstance(target, str) and target_id:
                related = {"object": target, "id": str(target_id), "name": names.get(str(target_id), "")}
        option = next((o for o in (type_field or {}).get("options") or [] if o["value"] == row.get(spec["type"])), None)
        out.append(
            {
                "kind": "activity" if direct else "mention",
                "object": obj["key"],
                "id": str(row["id"]),
                "date": _local_date(row.get(spec["date"]), timezone),
                "at": to_api(row.get("created_at"), None) or "",
                "subject": str(row.get(spec["subject"]) or ""),
                "type": option,
                "body": row.get(spec["body"]) if isinstance(row.get(spec["body"]), str) else None,
                "user_id": str(row[user_field["key"]]) if user_field and row.get(user_field["key"]) else None,
                "related": related,
            }
        )
    return out


def _names(conn: Connection, rows: list[dict[str, Any]], related_field: dict[str, Any] | None) -> dict[str, str]:
    """関連先の表示名をテーブルごとにまとめて引く。"""
    if not related_field:
        return {}
    cols = related_field["columns"]
    wanted: dict[str, list[str]] = {}
    for row in rows:
        target, target_id = row.get(cols["object"]), row.get(cols["id"])
        if isinstance(target, str) and target_id:
            wanted.setdefault(target, []).append(str(target_id))
    names: dict[str, str] = {}
    for target, ids in wanted.items():
        for key, value in ref_of(conn, target, ids).items():
            names[key] = value["name"]
    return names


def _completions(
    conn: Connection, obj: dict[str, Any], object_key: str, record_id: str, timezone: str
) -> list[dict[str, Any]]:
    table = table_of(obj)
    completion = obj["completion"]
    user_field = next((f for f in obj["fields"] if f["type"] == "user"), None)
    body_field = next((f for f in obj["fields"] if f["type"] in ("textarea", "richtext")), None)

    where: list[Any] = [table.c.deleted_at.is_(None), table.c[completion["field"]] == completion["done_value"]]
    rows = [dict(row._mapping) for row in conn.execute(select(table).where(*where))]
    out: list[dict[str, Any]] = []
    for row in rows:
        if not _points_to(obj, row, object_key, record_id):
            continue
        at_value = row.get(completion.get("completed_at_field") or "") or row.get("updated_at")
        raw = row.get(body_field["key"]) if body_field else None
        body = None
        if isinstance(raw, str) and raw:
            body = raw if body_field and body_field["type"] == "richtext" else _paragraphs(raw)
        out.append(
            {
                "kind": "completion",
                "object": obj["key"],
                "id": str(row["id"]),
                "date": _local_date(at_value, timezone),
                "at": to_api(at_value, None) or "",
                "subject": str(row.get(obj["name_field"]) or ""),
                "body": body,
                "user_id": str(row[user_field["key"]]) if user_field and row.get(user_field["key"]) else None,
                "related": None,
            }
        )
    return out
