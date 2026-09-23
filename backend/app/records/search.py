"""全テーブルの横断検索(04 §2 の `/search`)。正はモックの `searchAll`。"""

from typing import Any

from sqlalchemy import Connection, case, select

from app.meta import store
from app.records.normalize import normalize_text
from app.records.refs import display_value, ref_of
from app.records.tables import table_of

# 1 テーブルあたりの上限(画面の検索窓に出す数)
PER_OBJECT = 6


def search(conn: Connection, q: str) -> dict[str, Any]:
    needle = normalize_text(q)
    if not needle:
        return {"hits": []}
    pattern = "%" + needle.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%"
    hits: list[dict[str, Any]] = []
    for obj in store.live_objects(conn):
        table = table_of(obj)
        name_col = table.c[obj["name_field"]]
        stmt = (
            select(table)
            .where(table.c.deleted_at.is_(None), table.c.search_text.like(pattern, escape="\\"))
            # 名前に当たったものを先に(モックと同じ並び)
            .order_by(case((name_col.ilike(pattern, escape="\\"), 0), else_=1), table.c.id)
            .limit(PER_OBJECT)
        )
        for row in conn.execute(stmt):
            values = dict(row._mapping)
            hits.append(
                {
                    "object": obj["key"],
                    "id": str(row.id),
                    "name": str(values.get(obj["name_field"]) or ""),
                    "subtitle": _subtitle(conn, obj, values),
                }
            )
    return {"hits": hits}


def _subtitle(conn: Connection, obj: dict[str, Any], values: dict[str, Any]) -> str | None:
    """所属の取引先があればその名前、無ければ `subtitle_field`(モックと同じ優先順)。"""
    account_id = values.get("account_id")
    if isinstance(account_id, str):
        found = ref_of(conn, "accounts", [account_id])
        return found.get(account_id, {}).get("name")
    if obj.get("subtitle_field"):
        return display_value(conn, obj, values, obj["subtitle_field"])
    return None
