"""参照先の表示名(`references`)。**画面に JOIN をやらせない**(02 §1 の 3)。"""

from typing import Any

from sqlalchemy import Connection, select

from app.meta import store
from app.meta.tables import users as users_table
from app.records.tables import table_of


def _option_label(field: dict[str, Any], value: Any) -> str | None:
    for option in field.get("options") or []:
        if option["value"] == value:
            return str(option["label"])
    return None


def display_value(conn: Connection, obj: dict[str, Any], row: dict[str, Any], field_key: str) -> str | None:
    """列の値を人が読む文字列に(モックの `displayValue`)。参照はもう 1 段だけ解く。"""
    field = next((f for f in obj["fields"] if f["key"] == field_key), None)
    value = row.get(field_key)
    if value is None:
        return None
    if field is None:
        return str(value)
    if field["type"] == "select":
        return _option_label(field, value)
    if field["type"] == "multi_select":
        import json

        items = json.loads(value) if isinstance(value, str) else value
        labels = [_option_label(field, v) or str(v) for v in items]
        return "、".join(labels) or None
    if field["type"] == "relation" and field.get("target"):
        found = ref_of(conn, field["target"], [str(value)])
        return found.get(str(value), {}).get("name")
    if field["type"] == "user":
        found = ref_of(conn, "users", [str(value)])
        return found.get(str(value), {}).get("name")
    return str(value)


def ref_of(conn: Connection, object_key: str, ids: list[str]) -> dict[str, dict[str, Any]]:
    """ID → 表示情報。無い ID は入らない(消えた参照先は画面が ID のまま出す)。"""
    ids = [i for i in dict.fromkeys(ids) if i]
    if not ids:
        return {}
    if object_key == "users":
        rows = conn.execute(select(users_table).where(users_table.c.id.in_(ids)))
        return {str(r.id): {"id": str(r.id), "name": r.name, "subtitle": r.email} for r in rows}
    try:
        obj = store.object_meta(conn, object_key)
    except Exception:
        return {}
    table = table_of(obj)
    # 論理削除中でも表示名は解く(関連リストに出さないだけで、参照は保つ。08 §2 の 15)
    rows = conn.execute(select(table).where(table.c.id.in_(ids)))
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        values = dict(row._mapping)
        subtitle = None
        if obj.get("subtitle_field"):
            subtitle = display_value(conn, obj, values, obj["subtitle_field"])
        out[str(row.id)] = {
            "id": str(row.id),
            "name": str(values.get(obj["name_field"]) or ""),
            "subtitle": subtitle,
        }
    return out


def collect_references(conn: Connection, obj: dict[str, Any], records: list[dict[str, Any]]) -> dict[str, Any]:
    """返す行が指している参照先を、テーブルごとにまとめて引く。"""
    wanted: dict[str, list[str]] = {}
    for field in obj["fields"]:
        for record in records:
            if field["type"] == "relation" and field.get("target"):
                value = record.get(field["key"])
                if value:
                    wanted.setdefault(field["target"], []).append(str(value))
            elif field["type"] == "user":
                value = record.get(field["key"])
                if value:
                    wanted.setdefault("users", []).append(str(value))
            elif field["type"] == "polymorphic" and field.get("columns"):
                target = record.get(field["columns"]["object"])
                value = record.get(field["columns"]["id"])
                if isinstance(target, str) and value:
                    wanted.setdefault(target, []).append(str(value))
    return {key: found for key, ids in wanted.items() if (found := ref_of(conn, key, ids))}
