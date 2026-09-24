"""初期メタデータ(初めからある 5 つのテーブルとビュー)を DB に入れる。

正は `app/seed/*.json`。画面のモック(`frontend/src/mocks/fixtures/`)と同じ中身で、
`tests/test_seed.py` が食い違いを検出する。**ここが唯一の初期定義**で、
実テーブルはこの定義から DDL 経路(`ddl.py`)で作る。
"""

import json
from pathlib import Path
from typing import Any

from sqlalchemy import Connection, select

from app.config import get_settings
from app.meta import ddl
from app.meta.tables import meta_fields, meta_objects, meta_views, users, workspace

SEED_DIR = Path(__file__).resolve().parent.parent / "seed"

# 項目の定義のうち、meta_fields の列にそのまま入るもの
FIELD_COLUMNS = (
    "label",
    "type",
    "required",
    "readonly",
    "options",
    "target",
    "targets",
    "columns",
    "semantic",
    "in_create_form",
    "placeholder",
    "max_length",
    "scale",
    "locked",
    "all_targets",
)
OBJECT_COLUMNS = (
    "label",
    "icon",
    "color",
    "name_field",
    "subtitle_field",
    "position",
    "in_sidebar",
    "system",
    "completion",
    "timeline",
)


def load(name: str) -> Any:
    return json.loads((SEED_DIR / f"{name}.json").read_text(encoding="utf-8"))


def insert_object(conn: Connection, obj: dict[str, Any], *, user_id: Any = None) -> None:
    """テーブルの定義を `meta_*` に入れ、同じトランザクションで実テーブルを作る(02 §4)。"""
    values = {"key": obj["key"], **{c: obj.get(c) for c in OBJECT_COLUMNS}}
    values["in_sidebar"] = obj.get("in_sidebar", True)
    values["system"] = obj.get("system", False)
    conn.execute(meta_objects.insert().values(**values))
    for position, field in enumerate(obj["fields"], start=1):
        insert_field(conn, obj["key"], field, position)
    ddl.run(conn, ddl.create_table_statements(obj["key"], obj["fields"]), object_key=obj["key"], user_id=user_id)


def insert_field(conn: Connection, object_key: str, field: dict[str, Any], position: int) -> None:
    values: dict[str, Any] = {"object_key": object_key, "key": field["key"], "position": position}
    for column in FIELD_COLUMNS:
        if column in field:
            values[column] = field[column]
    conn.execute(meta_fields.insert().values(**values))


def seed(conn: Connection) -> None:
    """空の DB に初期のメタデータ・ワークスペース・利用者を入れる。2 回目は何もしない。"""
    if conn.execute(select(meta_objects.c.key).limit(1)).first() is not None:
        return
    settings = get_settings()
    conn.execute(workspace.insert().values(name=settings.workspace_name, timezone=settings.timezone))
    for obj in load("objects"):
        insert_object(conn, obj)
    for view in load("views"):
        conn.execute(
            meta_views.insert().values(
                id=view["id"],
                object_key=view["object"],
                name=view["name"],
                type=view["type"],
                position=view["position"],
                config=view["config"],
                pin=view.get("pin"),
            )
        )


def ensure_user(
    conn: Connection,
    *,
    name: str,
    email: str,
    admin: bool = False,
    id: str | None = None,
    avatar_color: str | None = None,
) -> Any:
    """利用者を 1 人用意する(既にいれば その ID を返す)。

    メールアドレスは小文字で持つ(ログインは Access の JWT のメールアドレスを小文字にして引く。03 §5)。
    """
    email = email.strip().lower()
    found = conn.execute(select(users.c.id).where(users.c.email == email)).scalar_one_or_none()
    if found is not None:
        return found
    values: dict[str, Any] = {"name": name, "email": email, "admin": admin}
    if id:
        values["id"] = id
    if avatar_color:
        values["avatar_color"] = avatar_color
    return conn.execute(users.insert().values(**values).returning(users.c.id)).scalar_one()
