"""テーブルの定義(`meta_*`)から SQLAlchemy の `Table` を組む。ORM のモデルは書かない(03 §4)。"""

from typing import Any

from sqlalchemy import BigInteger, Boolean, Column, Date, MetaData, Numeric, Table, Text, text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID

from app.errors import bad_request
from app.meta.ddl import COLUMN_TYPES

SQL_TYPES: dict[str, Any] = {
    "text": Text,
    "numeric": Numeric,
    "bigint": BigInteger,
    "date": Date,
    "timestamptz": lambda: TIMESTAMP(timezone=True),
    "boolean": Boolean,
    "jsonb": JSONB,
    "uuid": lambda: UUID(as_uuid=False),
}


def _column(name: str, sql_type: str) -> Column[Any]:
    factory = SQL_TYPES[sql_type]
    return Column(name, factory())


def table_of(obj: dict[str, Any]) -> Table:
    """1 つのテーブルの `Table`。呼ぶたびに組む(定義は要求ごとに読み直すので、古い形が残らない)。"""
    # 既定値は DDL(app/meta/ddl.py)が付けたものと同じにする。合っていないと insert で警告が出る
    columns: list[Column[Any]] = [
        Column("id", UUID(as_uuid=False), primary_key=True, server_default=text("uuidv7()")),
        Column("created_at", TIMESTAMP(timezone=True), server_default=text("clock_timestamp()")),
        Column("updated_at", TIMESTAMP(timezone=True), server_default=text("clock_timestamp()")),
        _column("deleted_at", "timestamptz"),
        _column("search_text", "text"),
    ]
    seen = {c.name for c in columns}
    for field in obj["fields"]:
        for name, sql_type in _field_columns(field):
            if name in seen:
                continue
            seen.add(name)
            columns.append(_column(name, sql_type))
    return Table(obj["key"], MetaData(), *columns)


def _field_columns(field: dict[str, Any]) -> list[tuple[str, str]]:
    if field["type"] == "polymorphic":
        cols = field.get("columns") or {}
        return [(cols["object"], "text"), (cols["id"], "uuid")]
    sql_type = COLUMN_TYPES.get(field["type"])
    if sql_type is None:
        raise bad_request(f"知らない項目の型です: {field['type']!r}")
    return [(field["key"], sql_type)]


def fields_by_column(obj: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """列名 → 項目の定義。polymorphic は 2 本とも同じ定義を指す。"""
    out: dict[str, dict[str, Any]] = {}
    for field in obj["fields"]:
        for name, _ in _field_columns(field):
            out[name] = field
    return out
