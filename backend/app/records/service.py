"""レコードの読み取り(04 §2 の `records/query` と 1 件)。書き込みは次(J-021 の続き)。"""

from typing import Any

from sqlalchemy import Connection, Select, Table, asc, case, desc, func, literal, nullslast, select
from sqlalchemy.sql.elements import ColumnElement

from app.errors import bad_request, not_found
from app.meta import store
from app.meta.tables import users as users_table
from app.records.filters import Context, compile_filter
from app.records.normalize import normalize_text
from app.records.refs import collect_references
from app.records.tables import fields_by_column, table_of
from app.records.values import row_to_api


def context(conn: Connection, me: str | None) -> Context:
    return Context(timezone=store.get_workspace(conn)["timezone"], me=me)


def _sort_key(conn: Connection, obj: dict[str, Any], table: Table, field_key: str) -> ColumnElement:
    """並びのキー。選択肢は**定義順**、参照は**参照先の表示名**で並べる(04 §4)。"""
    if field_key not in table.c:
        raise bad_request(f"知らない項目で並べようとしています: {field_key!r}")
    col = table.c[field_key]
    field = next((f for f in obj["fields"] if f["key"] == field_key), None)
    if field is None:
        return col
    if field["type"] == "select" and field.get("options"):
        order = {option["value"]: index for index, option in enumerate(field["options"])}
        return case(order, value=col, else_=literal(len(order)))
    if field["type"] == "user":
        return select(users_table.c.name).where(users_table.c.id == col).scalar_subquery()
    if field["type"] == "relation" and field.get("target"):
        try:
            target = store.object_meta(conn, field["target"])
        except Exception:
            return col
        target_table = table_of(target)
        return select(target_table.c[target["name_field"]]).where(target_table.c.id == col).scalar_subquery()
    return col


def _apply_sort(conn: Connection, stmt: Select, obj: dict[str, Any], table: Table, sorts: list[dict]) -> Select:
    for sort in sorts:
        key = _sort_key(conn, obj, table, sort["field"])
        direction = desc if sort.get("dir") == "desc" else asc
        # NULL は昇順・降順どちらでも末尾(04 §4)
        stmt = stmt.order_by(nullslast(direction(key)))
    return stmt


def _text_search(table: Table, q: str) -> ColumnElement:
    """一覧上部の絞り込み。正規化した 1 本の列に当てる(02 §4)。"""
    needle = normalize_text(q).replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
    return table.c.search_text.like(f"%{needle}%", escape="\\")


def query(conn: Connection, object_key: str, params: dict[str, Any], me: str | None) -> dict[str, Any]:
    obj = store.object_meta(conn, object_key)
    table = table_of(obj)
    fields = fields_by_column(obj)
    ctx = context(conn, me)

    where: list[ColumnElement] = [table.c.deleted_at.is_(None)]
    condition = compile_filter(table, fields, params.get("filter"), ctx)
    if condition is not None:
        where.append(condition)
    if params.get("q"):
        where.append(_text_search(table, str(params["q"])))

    total = conn.execute(select(func.count()).select_from(table).where(*where)).scalar_one()

    stmt = select(table).where(*where)
    stmt = _apply_sort(conn, stmt, obj, table, params.get("sort") or [])
    # 並びが決まらないときも、返す順が揺れないように(UUID v7 は作った順)
    stmt = stmt.order_by(table.c.id)
    if params.get("limit") is not None:
        stmt = stmt.limit(int(params["limit"]))
    if params.get("offset"):
        stmt = stmt.offset(int(params["offset"]))

    records = [row_to_api(row, fields) for row in conn.execute(stmt)]
    return {"records": records, "total": total, "references": collect_references(conn, obj, records)}


def find(conn: Connection, object_key: str, record_id: str) -> dict[str, Any]:
    obj = store.object_meta(conn, object_key)
    table = table_of(obj)
    fields = fields_by_column(obj)
    row = conn.execute(select(table).where(table.c.id == record_id, table.c.deleted_at.is_(None))).first()
    if row is None:
        raise not_found("レコードがありません")
    record = row_to_api(row, fields)
    return {"record": record, "references": collect_references(conn, obj, [record])}
