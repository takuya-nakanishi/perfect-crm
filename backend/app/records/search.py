"""全テーブルの横断検索(04 §2 の `/search`)。正はモックの `searchAll`。"""

from typing import Any

from sqlalchemy import Connection, bindparam, case, select

from app.meta import store
from app.records.normalize import normalize_text, search_text_of
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


def rebuild_search_text(conn: Connection, object_key: str) -> None:
    """検索用の列(`search_text`)を、いまの項目の定義で全行作り直す(削除中の行も)。

    テーブル設定で文字の項目を外した・戻したときに呼ぶ。外した項目の値で当たり続けないように(02 §5。
    モックは検索のたびに見えている項目から作るので、この列を持たない)。値は変えないので `updated_at` は動かさない。
    """
    obj = store.object_meta(conn, object_key)
    table = table_of(obj)
    rows = [
        {"_id": row.id, "_search_text": search_text_of(obj["fields"], dict(row._mapping))}
        for row in conn.execute(select(table))
    ]
    if rows:
        stmt = table.update().where(table.c.id == bindparam("_id")).values(search_text=bindparam("_search_text"))
        conn.execute(stmt, rows)
