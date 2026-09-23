"""レコードの読み書き(04 §2)。**書き込みの経路はここ 1 本**で、画面・取り込み・MCP のどれも通る。"""

import json
from datetime import UTC, date
from typing import Any

from sqlalchemy import Connection, Select, Table, asc, case, desc, func, literal, nullslast, select
from sqlalchemy.sql.elements import ColumnElement

from app.errors import bad_request, not_found
from app.meta import store
from app.meta.tables import SYSTEM_COLUMNS, activity_mentions
from app.meta.tables import users as users_table
from app.records.filters import Context, compile_filter
from app.records.normalize import normalize_text, search_text_of
from app.records.recurrence import copy_for_next, due_field_of, next_due
from app.records.refs import collect_references
from app.records.richtext import mentions_value
from app.records.rules import apply_rules, defaults_for_insert, today_in
from app.records.tables import fields_by_column, table_of
from app.records.validate import reject_unknown_columns, validate
from app.records.values import row_to_api, to_db


def _with_mentions(obj: dict[str, Any], record: dict[str, Any]) -> dict[str, Any]:
    """活動の行には `mentions`(言及先の `テーブル名:ID`)を添える。**正は `body`** なので、そこから作り直す。"""
    timeline = obj.get("timeline")
    if timeline:
        record["mentions"] = mentions_value(record.get(timeline["body"]))
    return record


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

    records = [_with_mentions(obj, row_to_api(row, fields)) for row in conn.execute(stmt)]
    return {"records": records, "total": total, "references": collect_references(conn, obj, records)}


def find(conn: Connection, object_key: str, record_id: str) -> dict[str, Any]:
    obj = store.object_meta(conn, object_key)
    table = table_of(obj)
    fields = fields_by_column(obj)
    row = conn.execute(select(table).where(table.c.id == record_id, table.c.deleted_at.is_(None))).first()
    if row is None:
        raise not_found("レコードがありません")
    record = _with_mentions(obj, row_to_api(row, fields))
    return {"record": record, "references": collect_references(conn, obj, [record])}


def _now() -> str:
    from datetime import datetime

    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _writable(table: Table, values: dict[str, Any], fields: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """実際に列がある値だけを、DB に入れられる形にして返す。"""
    return {key: to_db(value, fields.get(key)) for key, value in values.items() if key in table.c}


def _blank_row(obj: dict[str, Any]) -> dict[str, Any]:
    """作成時の下敷き。共通の列(id・作成日時・更新日時)はサーバ側の既定値に任せるので含めない。"""
    row: dict[str, Any] = {}
    for field in obj["fields"]:
        cols = field.get("columns")
        for name in [cols["object"], cols["id"]] if cols else [field["key"]]:
            if name not in SYSTEM_COLUMNS:
                row[name] = None
    return row


def insert(conn: Connection, object_key: str, values: dict[str, Any], me: str | None) -> dict[str, Any]:
    obj = store.object_meta(conn, object_key)
    reject_unknown_columns(obj, values)
    table = table_of(obj)
    fields = fields_by_column(obj)
    timezone = store.get_workspace(conn)["timezone"]
    now = _now()

    effective = {**defaults_for_insert(obj, me, timezone), **values}
    row = {**_blank_row(obj), **effective}
    row = validate(conn, obj, row, None)
    row = apply_rules(obj, None, row, effective, now=now, timezone=timezone)

    payload = _writable(table, row, fields)
    # 渡されていない共通の列は DB の既定値に任せる(移行で作成日時を指定したときは尊重する)
    for name in ("id", "created_at", "updated_at"):
        if payload.get(name) is None:
            payload.pop(name, None)
    payload["search_text"] = search_text_of(obj["fields"], row)
    record_id = conn.execute(table.insert().values(**payload).returning(table.c.id)).scalar_one()
    _sync_mentions(conn, obj, str(record_id), row)
    return find(conn, object_key, str(record_id))


def update(conn: Connection, object_key: str, record_id: str, patch: dict[str, Any], me: str | None) -> dict[str, Any]:
    obj = store.object_meta(conn, object_key)
    reject_unknown_columns(obj, patch)
    table = table_of(obj)
    fields = fields_by_column(obj)
    timezone = store.get_workspace(conn)["timezone"]
    now = _now()

    current = conn.execute(select(table).where(table.c.id == record_id, table.c.deleted_at.is_(None))).first()
    if current is None:
        raise not_found("レコードがありません")
    before = row_to_api(current, fields)

    row = {**before, **patch}
    row = validate(conn, obj, row, list(patch))
    row = apply_rules(obj, before, row, patch, now=now, timezone=timezone)

    payload = _writable(table, {k: v for k, v in row.items() if before.get(k) != v}, fields)
    payload.pop("id", None)
    payload.pop("created_at", None)
    payload["updated_at"] = now
    payload["search_text"] = search_text_of(obj["fields"], row)
    conn.execute(table.update().where(table.c.id == record_id).values(**payload))
    _sync_mentions(conn, obj, record_id, row)
    _apply_recurrence(conn, obj, {**row, "id": record_id}, patch, me)
    return find(conn, object_key, record_id)


def remove(conn: Connection, object_key: str, record_id: str) -> None:
    """論理削除(02 §4)。画面の「元に戻す」は `restore` でこれを外すだけ。"""
    obj = store.object_meta(conn, object_key)
    table = table_of(obj)
    result = conn.execute(
        table.update()
        .where(table.c.id == record_id, table.c.deleted_at.is_(None))
        .values(deleted_at=func.now(), updated_at=func.now())
    )
    if result.rowcount == 0:
        raise not_found("レコードがありません")


def restore(conn: Connection, object_key: str, record_id: str) -> dict[str, Any]:
    obj = store.object_meta(conn, object_key)
    table = table_of(obj)
    result = conn.execute(
        table.update()
        .where(table.c.id == record_id, table.c.deleted_at.isnot(None))
        .values(deleted_at=None, updated_at=func.now())
    )
    if result.rowcount == 0:
        raise not_found("削除されたレコードがありません")
    return find(conn, object_key, record_id)


def _sync_mentions(conn: Connection, obj: dict[str, Any], record_id: str, row: dict[str, Any]) -> None:
    """`body` から取った言及を結合表へ写す(時系列 API が引く。捨てて作り直せる導出値)。"""
    if not obj.get("timeline") or "mentions" not in row:
        return
    conn.execute(activity_mentions.delete().where(activity_mentions.c.activity_id == record_id))
    for ref in json.loads(row["mentions"] or "[]"):
        object_key, _, target_id = str(ref).partition(":")
        conn.execute(
            activity_mentions.insert().values(activity_id=record_id, object_key=object_key, record_id=target_id)
        )


def _apply_recurrence(
    conn: Connection, obj: dict[str, Any], row: dict[str, Any], patch: dict[str, Any], me: str | None
) -> None:
    """繰り返し(02 §3)。完了したら次回を作り、完了を戻したら自動で作った次回を消す。"""
    completion = obj.get("completion") or {}
    if not completion.get("repeat_field") or completion["field"] not in patch:
        return
    table = table_of(obj)
    repeat_of = completion.get("repeat_of_field")
    is_done = row.get(completion["field"]) == completion["done_value"]
    if not is_done:
        # この回から自動で作った次回が、まだ未着手ならば消す(だから「戻すと次回が消える」)
        if repeat_of:
            conn.execute(
                table.delete().where(
                    table.c[repeat_of] == row["id"], table.c[completion["field"]] == completion["open_value"]
                )
            )
        return
    rule = row.get(completion["repeat_field"])
    due_key = due_field_of(obj)
    if not rule or not due_key or not row.get(due_key):
        return
    from_completion = bool(
        completion.get("repeat_from_completion_field") and row.get(completion["repeat_from_completion_field"])
    )
    timezone = store.get_workspace(conn)["timezone"]
    base = date.fromisoformat(today_in(timezone) if from_completion else str(row[due_key])[:10])
    due = next_due(base, str(rule))
    if due is None:
        return
    # 既に次回がある(二重に完了を送った)なら作らない
    if repeat_of:
        found = conn.execute(select(table.c.id).where(table.c[repeat_of] == row["id"])).first()
        if found is not None:
            return
    insert(conn, obj["key"], copy_for_next(obj, row, due), me)
