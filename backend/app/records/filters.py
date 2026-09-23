"""フィルタ(04 §3)を SQL に訳す。**意味は画面の `frontend/src/lib/filter.ts` と同じにする**(J-021 の受け入れ条件)。

真理値の決まり:
- `eq` は NULL に対して偽、`ne` / `not_in` は **NULL を含む**(空も「違う」)
- `lt` 〜 `gte` は NULL に対して偽
- `contains` は文字の列だけ
- `is_empty` は NULL と空文字(複数選択は空の配列も)
- 複数選択(JSONB の配列)は `eq` / `in` / `contains` が「どれかを含む」、`ne` / `not_in` が「どれも含まない」
- 日時の列を日付と比べるときは、**ワークスペースの時刻帯**での日付に直してから比べる
"""

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import Date, Table, and_, cast, func, literal, not_, or_
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.sql.elements import ColumnElement

from app.errors import bad_request

DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TEXT_TYPES = frozenset({"text", "textarea", "richtext", "email", "phone", "url", "select"})
LIST_TYPES = frozenset({"multi_select", "drive_files"})
MACRO_OFFSET = re.compile(r"^\$today([+-]\d+)?$")


@dataclass(frozen=True)
class Context:
    """マクロを解くのに要るもの。「今日」はワークスペースの時刻帯で決める(08 §2 の 16)。"""

    timezone: str
    me: str | None

    @property
    def today(self) -> date:
        return date.today() if not self.timezone else _today(self.timezone)


def _today(tz: str) -> date:
    from datetime import datetime

    return datetime.now(ZoneInfo(tz)).date()


def resolve(value: Any, ctx: Context) -> Any:
    """`$today+7` や `$me` を実際の値にする(04 §3)。"""
    if not isinstance(value, str) or not value.startswith("$"):
        return value
    if value == "$me":
        return ctx.me
    today = ctx.today
    matched = MACRO_OFFSET.match(value)
    if matched:
        return (today + timedelta(days=int(matched.group(1) or 0))).isoformat()
    if value == "$start_of_month":
        return today.replace(day=1).isoformat()
    if value == "$end_of_month":
        next_month = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
        return (next_month - timedelta(days=1)).isoformat()
    return value


def _as_list(value: Any, ctx: Context) -> list[Any]:
    values = value if isinstance(value, list) else [value]
    return [resolve(v, ctx) for v in values]


def coerce(value: Any, field: dict[str, Any], *, as_date: bool = False) -> Any:
    """条件の値を、列の型に合わせた Python の値にする(そのまま渡すと `date <= varchar` で落ちる)。"""
    if value is None or isinstance(value, bool):
        return value
    ftype = field.get("type")
    try:
        if ftype == "date" or as_date:
            return date.fromisoformat(value[:10]) if isinstance(value, str) else value
        if ftype == "datetime":
            if isinstance(value, str):
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            return value
        if ftype == "currency":
            return int(value)
        if ftype in ("number", "percent"):
            return Decimal(str(value))
        if ftype == "checkbox":
            return value if isinstance(value, bool) else str(value).lower() == "true"
    except (ValueError, TypeError, ArithmeticError) as exc:
        raise bad_request(f"{field.get('key')} の条件の値が型に合いません: {value!r}") from exc
    return value


def _aligned(col: ColumnElement, field: dict[str, Any], target: Any, ctx: Context) -> ColumnElement:
    """日時の列を日付と比べるときは、時刻帯を合わせて日付に落とす(UTC のままだと朝が前日になる)。"""
    if field.get("type") == "datetime" and isinstance(target, str) and DATE_ONLY.match(target):
        return cast(func.timezone(ctx.timezone, col), Date)
    return col


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")


def _list_condition(col: ColumnElement, op: str, wanted: list[Any]) -> ColumnElement:
    """複数選択(JSONB の配列)。`?|` で「どれかを含む」を見る。"""
    keys = [str(v) for v in wanted if v is not None]
    if not keys:
        return literal(False)
    hit = col.has_any(array(keys))
    if op in ("eq", "in", "contains"):
        return and_(col.isnot(None), hit)
    if op in ("ne", "not_in"):
        return or_(col.is_(None), not_(hit))
    return literal(False)


def _is_empty(col: ColumnElement, field: dict[str, Any]) -> ColumnElement:
    ftype = field.get("type")
    if ftype in LIST_TYPES:
        return or_(col.is_(None), func.jsonb_array_length(col) == 0)
    if ftype in TEXT_TYPES:
        return or_(col.is_(None), col == "")
    return col.is_(None)


def condition(table: Table, fields: dict[str, dict[str, Any]], cond: dict[str, Any], ctx: Context) -> ColumnElement:
    key = cond.get("field")
    op = cond.get("op")
    if not isinstance(key, str) or key not in table.c:
        raise bad_request(f"知らない項目の条件です: {key!r}")
    col = table.c[key]
    field = fields.get(key, {})
    ftype = field.get("type")

    if op == "is_empty":
        return _is_empty(col, field)
    if op == "is_not_empty":
        return not_(_is_empty(col, field))

    if ftype in LIST_TYPES:
        return _list_condition(col, str(op), _as_list(cond.get("value"), ctx))

    if op in ("in", "not_in"):
        wanted = [coerce(v, field) for v in _as_list(cond.get("value"), ctx)]
        present = [v for v in wanted if v is not None]
        has_null = len(present) != len(wanted)
        if op == "in":
            hit = col.in_(present) if present else literal(False)
            return or_(hit, col.is_(None)) if has_null else hit
        miss = col.notin_(present) if present else literal(True)
        # not_in は NULL を含む(04 §3)
        return and_(miss, col.isnot(None)) if has_null else or_(miss, col.is_(None))

    raw = cond.get("value")
    target = resolve(raw[0] if isinstance(raw, list) else raw, ctx)
    aligned = _aligned(col, field, target, ctx)
    # 日時の列を日付と比べるときは、日付どうしの比較になる
    target = coerce(target, field, as_date=aligned is not col and ftype == "datetime")

    if op == "eq":
        return aligned == target
    if op == "ne":
        # 空文字も「違う」(モックの isEmpty と揃える)
        if ftype in TEXT_TYPES:
            return or_(col.is_(None), col == "", aligned.isnot(None) & (aligned != target))
        return aligned.is_distinct_from(target)
    if op == "contains":
        if ftype not in TEXT_TYPES or not isinstance(target, str):
            return literal(False)
        return col.ilike(f"%{_escape_like(target)}%", escape="\\")
    if op in ("lt", "lte", "gt", "gte"):
        if target is None:
            return literal(False)
        return {"lt": aligned < target, "lte": aligned <= target, "gt": aligned > target, "gte": aligned >= target}[op]
    raise bad_request(f"知らない演算子です: {op!r}")


def compile_filter(
    table: Table, fields: dict[str, dict[str, Any]], filter_: dict[str, Any] | None, ctx: Context
) -> ColumnElement | None:
    if not filter_:
        return None
    if "and" in filter_:
        parts = [compile_filter(table, fields, f, ctx) for f in filter_["and"]]
        kept = [p for p in parts if p is not None]
        return and_(*kept) if kept else None
    if "or" in filter_:
        parts = [compile_filter(table, fields, f, ctx) for f in filter_["or"]]
        kept = [p for p in parts if p is not None]
        return or_(*kept) if kept else None
    return condition(table, fields, filter_, ctx)
