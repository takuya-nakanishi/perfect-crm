"""集計(04 §5)。レポートの数字タイルとグラフが使う。正はモックの `aggregate`。"""

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, Date, Table, cast, func, select
from sqlalchemy.sql.elements import ColumnElement

from app.errors import bad_request
from app.meta import store
from app.records.filters import Context, compile_filter
from app.records.refs import ref_of
from app.records.tables import fields_by_column, table_of


def _number(value: Any) -> float | int:
    if value is None:
        return 0
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return value


def _measure(table: Table, measure: dict[str, Any]) -> ColumnElement:
    op = measure.get("op")
    if op == "count":
        return func.count()
    key = measure.get("field")
    if not key or key not in table.c:
        raise bad_request(f"集計する項目がありません: {key!r}")
    value: ColumnElement = table.c[key]
    weight_key = measure.get("weight_field")
    if weight_key:
        if weight_key not in table.c:
            raise bad_request(f"重みの項目がありません: {weight_key!r}")
        # 確度(0〜100)を百分率として掛けてから足す(04 §5)
        value = value * func.coalesce(table.c[weight_key], 100) / 100
    if op == "sum":
        return func.coalesce(func.sum(value), 0)
    if op == "avg":
        return func.coalesce(func.avg(value), 0)
    raise bad_request(f"知らない集計です: {op!r}")


def _month_label(key: str, with_year: bool) -> str:
    year, month = key.split("-")[:2]
    return f"{int(year)}年{int(month)}月" if with_year or int(month) == 1 else f"{int(month)}月"


def _day_label(key: str) -> str:
    parsed = date.fromisoformat(key)
    return f"{parsed.month}/{parsed.day}"


def _add_months(base: date, months: int) -> date:
    total = base.year * 12 + (base.month - 1) + months
    return date(total // 12, total % 12 + 1, 1)


def _bucket_keys(bucket: str, today: date, span: dict[str, Any]) -> list[str]:
    """空の区間も 0 で返すために、範囲の区間を全部並べる(04 §5)。"""
    start, end = int(span.get("from", -5)), int(span.get("to", 0))
    if bucket == "month":
        return [_add_months(today.replace(day=1), i).strftime("%Y-%m") for i in range(start, end + 1)]
    return [(today + timedelta(days=i)).isoformat() for i in range(start, end + 1)]


def _bucket_expr(col: ColumnElement, field: dict[str, Any], bucket: str, timezone: str) -> ColumnElement:
    day = cast(func.timezone(timezone, col), Date) if field.get("type") == "datetime" else col
    return func.to_char(day, "YYYY-MM") if bucket == "month" else cast(day, Date)


def aggregate(conn: Connection, object_key: str, params: dict[str, Any], me: str | None) -> dict[str, Any]:
    obj = store.object_meta(conn, object_key)
    table = table_of(obj)
    fields = fields_by_column(obj)
    workspace = store.get_workspace(conn)
    ctx = Context(timezone=workspace["timezone"], me=me)

    where: list[ColumnElement] = [table.c.deleted_at.is_(None)]
    condition = compile_filter(table, fields, params.get("filter"), ctx)
    if condition is not None:
        where.append(condition)
    measure = _measure(table, params.get("measure") or {})

    group_by = params.get("group_by")
    if not group_by:
        value = conn.execute(select(measure).select_from(table).where(*where)).scalar_one()
        return {"rows": [{"key": None, "label": "", "value": _number(value)}]}

    key = group_by.get("field")
    if key not in table.c:
        raise bad_request(f"知らない項目で分けようとしています: {key!r}")
    col = table.c[key]
    field = fields.get(key, {})

    if group_by.get("bucket"):
        return {"rows": _bucketed(conn, table, col, field, where, measure, group_by, ctx.timezone)}
    return {"rows": _grouped(conn, obj, table, col, field, key, where, measure, params)}


def _bucketed(
    conn: Connection,
    table: Table,
    col: ColumnElement,
    field: dict[str, Any],
    where: list[ColumnElement],
    measure: ColumnElement,
    group_by: dict[str, Any],
    timezone: str,
) -> list[dict[str, Any]]:
    bucket = str(group_by["bucket"])
    expr = _bucket_expr(col, field, bucket, timezone)
    rows = conn.execute(select(expr.label("bucket"), measure).select_from(table).where(*where).group_by(expr))
    found = {_bucket_key(row.bucket): _number(row[1]) for row in rows if row.bucket is not None}
    today = datetime.now(ZoneInfo(timezone)).date()
    keys = _bucket_keys(bucket, today, group_by.get("range") or {"from": -5, "to": 0})
    return [
        {
            "key": key,
            "label": _month_label(key, index == 0) if bucket == "month" else _day_label(key),
            "value": found.get(key, 0),
        }
        for index, key in enumerate(keys)
    ]


def _bucket_key(value: Any) -> str:
    return value.isoformat() if isinstance(value, date) else str(value)


def _grouped(
    conn: Connection,
    obj: dict[str, Any],
    table: Table,
    col: ColumnElement,
    field: dict[str, Any],
    key: str,
    where: list[ColumnElement],
    measure: ColumnElement,
    params: dict[str, Any],
) -> list[dict[str, Any]]:
    rows = list(conn.execute(select(col.label("key"), measure).select_from(table).where(*where).group_by(col)))
    # 関連先(polymorphic)の「どのテーブルか」の列で分けるとき
    polymorphic = any(f.get("columns", {}).get("object") == key for f in obj["fields"] if f["type"] == "polymorphic")
    options = field.get("options") or []
    by_value = {o["value"]: o for o in options}

    out: list[dict[str, Any]] = []
    ref_ids = [str(r.key) for r in rows if r.key not in (None, "")]
    refs: dict[str, dict[str, Any]] = {}
    if field.get("type") == "relation" and field.get("target"):
        refs = ref_of(conn, field["target"], ref_ids)
    elif field.get("type") == "user":
        refs = ref_of(conn, "users", ref_ids)
    labels = {o["key"]: o["label"] for o in store.all_objects(conn)} if polymorphic else {}

    for row in rows:
        raw = row.key
        group_key = None if raw is None or raw == "" else str(raw)
        option = by_value.get(group_key)
        if group_key is None:
            label = "関連先なし" if polymorphic else "未設定"
        elif option:
            label = option["label"]
        elif group_key in refs:
            label = refs[group_key]["name"]
        elif polymorphic:
            label = labels.get(group_key, group_key)
        else:
            label = group_key
        entry: dict[str, Any] = {"key": group_key, "label": label, "value": _number(row[1])}
        if option and option.get("color"):
            entry["color"] = option["color"]
        out.append(entry)

    if options and params.get("order") != "value_desc":
        order = {o["value"]: i for i, o in enumerate(options)}
        out.sort(key=lambda r: 999 if r["key"] is None else order.get(r["key"], 998))
    else:
        out.sort(key=lambda r: (r["key"] is None, -r["value"]))
    limit = params.get("limit")
    return out[: int(limit)] if limit else out
