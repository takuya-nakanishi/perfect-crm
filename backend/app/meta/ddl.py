"""メタデータ(`meta_objects` / `meta_fields`)から、実テーブルの DDL を組んで流す層。

**DDL を流す経路はここ 1 本だけ**(02 §4)。初めからある 5 つのテーブルも、画面から足したテーブルも同じ道を通る。
`DROP TABLE` / `DROP COLUMN` は**作らない**。項目を外すのはメタデータで隠すだけで、列の値は残す(02 §5)。
"""

import re
from typing import Any

from sqlalchemy import Connection, text

from app.errors import bad_request
from app.meta.tables import SYSTEM_COLUMNS, SYSTEM_TABLES, ddl_log

# 列名・テーブル名の規則(02 §5)。小文字の英字で始まり、英数字と _
IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")
MAX_IDENTIFIER = 40

# 項目の型 → PostgreSQL の型。NOT NULL は**付けない**:
# 必須(required)は、あとから付けられる属性で、既存の行が空のことがある。検証はアプリ側(04 §11)で行い、
# DB の制約にすると「あとから必須にする」が失敗する。DB が守るのは型と参照整合だけ
COLUMN_TYPES: dict[str, str] = {
    "text": "text",
    "textarea": "text",
    "richtext": "text",
    "email": "text",
    "phone": "text",
    "url": "text",
    "select": "text",
    "number": "numeric",
    "percent": "numeric",
    "currency": "bigint",
    "date": "date",
    "datetime": "timestamptz",
    "checkbox": "boolean",
    "multi_select": "jsonb",
    "drive_files": "jsonb",
    "relation": "uuid",
    "user": "uuid",
}


def check_identifier(name: str, *, what: str = "名前") -> str:
    if not name or not IDENTIFIER.match(name):
        raise bad_request(f"{what}は小文字の英字で始まり、英数字と _ だけが使えます: {name!r}")
    if len(name) > MAX_IDENTIFIER:
        raise bad_request(f"{what}は {MAX_IDENTIFIER} 文字までです: {name!r}")
    return name


def check_table_name(key: str) -> str:
    check_identifier(key, what="テーブル名")
    if key in SYSTEM_TABLES:
        raise bad_request(f"{key} はシステムが使う名前です")
    return key


def check_column_name(key: str) -> str:
    check_identifier(key, what="列名")
    if key in SYSTEM_COLUMNS:
        raise bad_request(f"{key} は予約された列名です")
    return key


def column_defs(field: dict[str, Any]) -> list[tuple[str, str]]:
    """項目 1 つが持つ実際の列(名前, 型)。polymorphic だけ 2 本になる。

    **共通の列(`created_at` など)を指す項目は空を返す。**メタデータには「一覧に出す項目」として
    `created_at` / `updated_at` が入っているが、列そのものは DDL が必ず作るので、ここでは重ねない。
    """
    ftype = field["type"]
    if ftype == "polymorphic":
        cols = field.get("columns") or {}
        obj, rid = cols.get("object"), cols.get("id")
        if not obj or not rid:
            raise bad_request(f"polymorphic の項目 {field['key']!r} には columns.object と columns.id が要ります")
        return [(name, sql_type) for name, sql_type in ((obj, "text"), (rid, "uuid")) if _needs_column(name)]
    sql_type = COLUMN_TYPES.get(ftype)
    if sql_type is None:
        raise bad_request(f"知らない項目の型です: {ftype!r}")
    if not _needs_column(field["key"]):
        return []
    return [(check_identifier(field["key"], what="列名"), sql_type)]


def _needs_column(name: str) -> bool:
    return name not in SYSTEM_COLUMNS


def _references(field: dict[str, Any]) -> str | None:
    """外部キーを張る先(relation と user のみ。polymorphic は FK を張れない)。"""
    if not _needs_column(field["key"]):
        return None
    if field["type"] == "user":
        return "users"
    if field["type"] == "relation":
        target = field.get("target")
        if not target:
            raise bad_request(f"参照の項目 {field['key']!r} には target が要ります")
        return check_table_name(target)
    return None


def create_table_statements(object_key: str, fields: list[dict[str, Any]]) -> list[str]:
    """テーブルを 1 つ作る DDL。共通の列(id・created_at・updated_at・deleted_at・search_text)を必ず付ける。"""
    key = check_table_name(object_key)
    lines = [
        "id uuid primary key default uuidv7()",
        # clock_timestamp()(実時刻)を使う。now() はトランザクション開始時刻なので、
        # CSV の一括取り込みで全行が同じ時刻になり、一覧の並びが取り込んだ順にならない
        "created_at timestamptz not null default clock_timestamp()",
        "updated_at timestamptz not null default clock_timestamp()",
        "deleted_at timestamptz",
        # 検索用の 1 本。ひらがな・カタカナ・全角半角の正規化はアプリが吸収して入れる(02 §4)
        "search_text text",
    ]
    fks: list[str] = []
    for field in fields:
        for name, sql_type in column_defs(field):
            lines.append(f"{name} {sql_type}")
        ref = _references(field)
        if ref:
            fks.append(f"foreign key ({field['key']}) references {ref} (id)")
    body = ",\n  ".join(lines + fks)
    out = [f"create table {key} (\n  {body}\n)"]
    out += _index_statements(key, fields)
    return out


def _index_statements(key: str, fields: list[dict[str, Any]]) -> list[str]:
    out = [
        # 全部の読み取りが deleted_at IS NULL を挟む(08 §3 の 5)
        f"create index {key}_alive_idx on {key} (id) where deleted_at is null",
        f"create index {key}_search_idx on {key} using gin (search_text gin_trgm_ops)",
    ]
    for field in fields:
        if not _needs_column(field["key"]):
            continue
        if field["type"] in ("relation", "user"):
            out.append(f"create index {key}_{field['key']}_idx on {key} ({field['key']})")
        elif field["type"] == "polymorphic":
            cols = field.get("columns") or {}
            out.append(f"create index {key}_{field['key']}_idx on {key} ({cols['object']}, {cols['id']})")
    return out


def add_column_statements(object_key: str, field: dict[str, Any]) -> list[str]:
    """項目を 1 つ足す DDL。`ADD COLUMN` だけで、`DROP COLUMN` は作らない(02 §4)。"""
    key = check_table_name(object_key)
    out = [f"alter table {key} add column if not exists {name} {sql_type}" for name, sql_type in column_defs(field)]
    ref = _references(field)
    if ref:
        out.append(
            f"alter table {key} add constraint {key}_{field['key']}_fkey "
            f"foreign key ({field['key']}) references {ref} (id)"
        )
    out += _index_statements_for_new_field(key, field)
    return out


def _index_statements_for_new_field(key: str, field: dict[str, Any]) -> list[str]:
    if field["type"] in ("relation", "user"):
        return [f"create index if not exists {key}_{field['key']}_idx on {key} ({field['key']})"]
    if field["type"] == "polymorphic":
        cols = field.get("columns") or {}
        return [f"create index if not exists {key}_{field['key']}_idx on {key} ({cols['object']}, {cols['id']})"]
    return []


def run(conn: Connection, statements: list[str], *, object_key: str | None, user_id: Any = None) -> None:
    """DDL を流し、履歴に残す。`meta_*` の更新と同じトランザクションで呼ぶこと(02 §4)。"""
    for statement in statements:
        conn.execute(text(statement))
        conn.execute(ddl_log.insert().values(object_key=object_key, statement=statement, user_id=user_id))
