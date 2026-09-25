"""画面からのテーブル設定(04 §6、決まりは 02 §5)。正はモックの `frontend/src/mocks/schema.ts`。

**列名と型は変えられない。項目を外しても列の値は残す**(定義は `hidden` で保管し、同じ列名で戻せば復活する)。
DDL を流すのは `ddl.py` 1 本で、`meta_*` の更新と同じトランザクションで行う(02 §4)。
"""

import re
from typing import Any

from sqlalchemy import Connection, func, select

from app.errors import bad_request, not_found
from app.meta import ddl, store
from app.meta.tables import meta_fields, meta_objects, meta_views
from app.records.search import rebuild_search_text

KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
RESERVED_FIELD_KEYS = {"id", "created_at", "updated_at"}
RESERVED_OBJECT_KEYS = {"users", "meta", "session", "search"}
# 画面から足せる型。polymorphic は初めから入っているテーブルだけが持つ
CREATABLE = (
    "text", "textarea", "richtext", "number", "currency", "percent", "date", "datetime",
    "select", "multi_select", "checkbox", "email", "phone", "url", "relation", "user", "drive_files",
)  # fmt: skip
TEXT_TYPES = frozenset({"text", "textarea", "richtext", "email", "phone", "url"})
TAG_COLORS = ("gray", "green", "teal", "blue", "violet", "pink", "red", "orange", "amber")
SYSTEM_FIELDS = (
    {"key": "created_at", "label": "作成日時", "type": "datetime", "readonly": True},
    {"key": "updated_at", "label": "更新日時", "type": "datetime", "readonly": True},
)
# `meta_fields` にそのまま入る属性(画面から決められるものと、引き継ぐもの)
FIELD_COLUMNS = (
    "label", "type", "required", "readonly", "options", "target", "targets", "columns",
    "semantic", "in_create_form", "placeholder", "max_length", "scale", "locked", "all_targets",
)  # fmt: skip
FLAG_COLUMNS = ("required", "readonly", "locked", "all_targets")
COLUMN_WIDTH = {
    "relation": 200,
    "email": 220,
    "url": 200,
    "phone": 150,
    "checkbox": 90,
    "datetime": 140,
    "textarea": 240,
}


def _live_keys(conn: Connection) -> set[str]:
    return {o["key"] for o in store.all_objects(conn)}


def build_field(field_input: dict[str, Any], existing: dict[str, Any] | None) -> dict[str, Any]:
    """入力から 1 項目の定義を作る。画面から決められない属性(`semantic` など)は既存から引き継ぐ。"""
    label = str(field_input.get("label") or "").strip()
    key = str(field_input.get("key") or "")
    ftype = field_input.get("type")
    if not label:
        raise bad_request("項目名を入力してください")
    if not KEY_PATTERN.match(key):
        raise bad_request(f"「{label}」の列名は、小文字の英字で始め、英数字と _ で書いてください")
    if key in RESERVED_FIELD_KEYS:
        raise bad_request(f"列名 {key} はシステムが使っています")
    if existing and existing["type"] != ftype:
        raise bad_request(f"「{label}」の型は変えられません")
    if not existing and ftype not in CREATABLE:
        raise bad_request(f"「{label}」の型は選べません")

    field: dict[str, Any] = {**(existing or {}), "key": key, "label": label, "type": ftype}
    field.pop("required", None)
    if field_input.get("required"):
        field["required"] = True
    field.pop("max_length", None)
    field.pop("scale", None)
    if ftype in TEXT_TYPES and field_input.get("max_length") is not None:
        value = field_input["max_length"]
        if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 100000:
            raise bad_request(f"「{label}」の桁数は 1 以上の整数で指定してください")
        field["max_length"] = value
    if ftype in ("number", "percent") and field_input.get("scale") is not None:
        value = field_input["scale"]
        if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 6:
            raise bad_request(f"「{label}」の小数の桁数は 0〜6 で指定してください")
        field["scale"] = value
    placeholder = str(field_input.get("placeholder") or "").strip()
    field.pop("placeholder", None)
    if placeholder:
        field["placeholder"] = placeholder
    if ftype in ("select", "multi_select"):
        field["options"] = _build_options(label, field_input.get("options") or [], existing)
    if ftype == "relation":
        field["target"] = existing["target"] if existing else field_input.get("target")
    return field


def _build_options(label: str, given: list[dict[str, Any]], existing: dict[str, Any] | None) -> list[dict[str, Any]]:
    options = [{**o, "label": str(o.get("label") or "").strip()} for o in given]
    options = [o for o in options if o["label"]]
    if not options:
        raise bad_request(f"「{label}」に選択肢を 1 つ以上入れてください")
    if len({o["value"] for o in options}) != len(options):
        raise bad_request(f"「{label}」の選択肢が重なっています")
    for option in options:
        if option.get("color") not in TAG_COLORS:
            raise bad_request(f"「{label}」の選択肢の色が正しくありません")
    # 画面から決められない属性(kind・probability)は、同じ value の既存の選択肢から引き継ぐ(04 §6)
    previous = {o["value"]: o for o in (existing or {}).get("options") or []}
    return [{**previous.get(o["value"], {}), **o} for o in options]


def _check_object_input(conn: Connection, body: dict[str, Any]) -> None:
    if not str(body.get("label") or "").strip():
        raise bad_request("テーブル名を入力してください")
    if body.get("color") not in TAG_COLORS:
        raise bad_request("色が正しくありません")
    keys = [f.get("key") for f in body.get("fields") or []]
    for index, key in enumerate(keys):
        if key in keys[:index]:
            raise bad_request(f"列名 {key} が重なっています")


def create_object(conn: Connection, body: dict[str, Any], user_id: Any = None) -> None:
    _check_object_input(conn, body)
    key = str(body.get("key") or "")
    if not KEY_PATTERN.match(key):
        raise bad_request("テーブルの列名は、小文字の英字で始め、英数字と _ で書いてください")
    if key in RESERVED_OBJECT_KEYS:
        raise bad_request(f"{key} はシステムが使っています")
    found = conn.execute(select(meta_objects.c.deleted_at).where(meta_objects.c.key == key)).first()
    if found is not None:
        if found.deleted_at is None:
            raise bad_request(f"{key} という名前のテーブルは既にあります")
        # 削除済みの同名は上書きさせない(復元できる保証を守る。02 §5)
        raise bad_request(f"{key} は削除済みのテーブルにあります。元に戻すか、別の列名にしてください")
    given = body.get("fields") or []
    if not given:
        raise bad_request("項目を 1 つ以上入れてください")
    if given[0].get("type") != "text":
        raise bad_request("先頭の項目はレコードの表示名になるので、文字(1 行)にしてください")

    fields = [build_field({**f, "required": True} if i == 0 else f, None) for i, f in enumerate(given)]
    subtitle = next((f["key"] for f in fields if f["type"] == "select"), None)
    position = (conn.execute(select(func.max(meta_objects.c.position))).scalar() or 0) + 1
    conn.execute(
        meta_objects.insert().values(
            key=key,
            label=str(body["label"]).strip(),
            icon=body.get("icon") or "box",
            color=body["color"],
            name_field=fields[0]["key"],
            subtitle_field=subtitle,
            position=position,
            in_sidebar=body.get("in_sidebar", True),
        )
    )
    all_fields = [*fields, *({**f} for f in SYSTEM_FIELDS)]
    for index, field in enumerate(all_fields, start=1):
        _insert_field(conn, key, field, index)
    ddl.run(conn, ddl.create_table_statements(key, fields), object_key=key, user_id=user_id)
    _extend_all_targets(conn, key)
    ensure_views(conn, store.object_meta(conn, key), [])


def _insert_field(conn: Connection, object_key: str, field: dict[str, Any], position: int) -> None:
    values: dict[str, Any] = {"object_key": object_key, "key": field["key"], "position": position}
    for column in FIELD_COLUMNS:
        if column in field and field[column] is not None:
            values[column] = field[column]
    conn.execute(meta_fields.insert().values(**values))


def _extend_all_targets(conn: Connection, new_key: str) -> None:
    """「全テーブルを指せる」関連先(活動)には、新しいテーブルも加える。"""
    rows = conn.execute(select(meta_fields).where(meta_fields.c.all_targets.is_(True)))
    for row in rows:
        targets = list(row.targets or [])
        if new_key not in targets:
            conn.execute(
                meta_fields.update()
                .where(meta_fields.c.object_key == row.object_key, meta_fields.c.key == row.key)
                .values(targets=[*targets, new_key])
            )


def is_protected_field(obj: dict[str, Any], field: dict[str, Any]) -> bool:
    """外せない項目か(表示名、システムの列、業務ルールが使う列、関連先)。"""
    completion = obj.get("completion") or {}
    timeline = obj.get("timeline") or {}
    return bool(
        field["key"] == obj["name_field"]
        or field.get("readonly")
        or field.get("locked")
        or field["type"] == "polymorphic"
        or field["key"] == completion.get("field")
        or field["key"] == completion.get("completed_at_field")
        or (timeline and field["key"] in (timeline["subject"], timeline["type"], timeline["date"], timeline["body"]))
    )


def _field_rows(conn: Connection, key: str) -> list[Any]:
    return list(
        conn.execute(select(meta_fields).where(meta_fields.c.object_key == key).order_by(meta_fields.c.position))
    )


def _as_field(row: Any) -> dict[str, Any]:
    field: dict[str, Any] = {"key": row.key, "label": row.label, "type": row.type}
    for name in ("required", "readonly", "locked", "all_targets"):
        if getattr(row, name):
            field[name] = True
    for name in ("options", "target", "targets", "columns", "semantic", "in_create_form", "placeholder",
                 "max_length", "scale"):  # fmt: skip
        value = row._mapping[name]
        if value is not None:
            field[name] = value
    return field


def _is_live_field(field: dict[str, Any], live: set[str]) -> bool:
    """`GET /meta` で見えている項目か(参照先が削除中の relation は隠れる)。"""
    return field["type"] != "relation" or field.get("target") in live


def update_object(conn: Connection, key: str, body: dict[str, Any], user_id: Any = None) -> None:
    live = _live_keys(conn)
    if key not in live:
        raise not_found(f"テーブルがありません: {key}")
    _check_object_input(conn, body)
    obj = store.object_meta(conn, key)
    rows = _field_rows(conn, key)
    current = {row.key: row for row in rows}
    editable = [_as_field(row) for row in rows if not row.hidden and not row.readonly]
    removed = {row.key: _as_field(row) for row in rows if row.hidden}

    given = list(body.get("fields") or [])
    given_keys = {f.get("key") for f in given}
    for field in editable:
        if is_protected_field(obj, field) and field["key"] not in given_keys:
            raise bad_request(f"「{field['label']}」は外せません")
    for field_input in given:
        if field_input.get("key") == obj["name_field"]:
            field_input["required"] = True

    by_key = {f["key"]: f for f in editable}
    fields: list[dict[str, Any]] = []
    added: list[dict[str, Any]] = []
    for field_input in given:
        existing = by_key.get(field_input.get("key")) or removed.get(field_input.get("key"))
        built = build_field(field_input, existing)
        if built["key"] not in by_key:
            added.append(built)
        fields.append(built)

    # 参照先が削除中で `GET /meta` から隠れている項目は、全量置換の本文に無くても外さない(08 §1 の 3)
    hidden_alive = [f for f in editable if not _is_live_field(f, live) and f["key"] not in given_keys]
    _check_completion_options(obj, fields)

    conn.execute(
        meta_objects.update()
        .where(meta_objects.c.key == key)
        .values(
            label=str(body["label"]).strip(),
            icon=body.get("icon") or obj["icon"],
            color=body["color"],
            in_sidebar=body.get("in_sidebar", obj.get("in_sidebar", True)),
            subtitle_field=obj.get("subtitle_field")
            if any(f["key"] == obj.get("subtitle_field") for f in fields)
            else None,
            updated_at=func.clock_timestamp(),
        )
    )

    kept = [*fields, *hidden_alive]
    position = 0
    for field in kept:
        position += 1
        _save_field(conn, key, field, position, hidden=False, existing=current.get(field["key"]))
    for row in rows:
        if row.readonly:
            position += 1
            conn.execute(
                meta_fields.update()
                .where(meta_fields.c.object_key == key, meta_fields.c.key == row.key)
                .values(position=position, hidden=False)
            )
    # 本文から外れた項目は、定義を保管して隠す(列の値は残す。02 §5)
    kept_keys = {f["key"] for f in kept} | {row.key for row in rows if row.readonly}
    for row in rows:
        if row.key not in kept_keys and not row.hidden:
            position += 1
            conn.execute(
                meta_fields.update()
                .where(meta_fields.c.object_key == key, meta_fields.c.key == row.key)
                .values(hidden=True, position=position, updated_at=func.clock_timestamp())
            )

    for field in added:
        ddl.run(conn, ddl.add_column_statements(key, field), object_key=key, user_id=user_id)
    ensure_views(conn, store.object_meta(conn, key), added)

    # 文字の項目を外した・戻したら、検索用の列を作り直す(外した項目の値で当たらないように。02 §5)
    text_before = {f["key"] for f in editable if f["type"] in TEXT_TYPES}
    text_after = {f["key"] for f in kept if f["type"] in TEXT_TYPES}
    if text_before - text_after or (text_after - text_before) & removed.keys():
        rebuild_search_text(conn, key)


def _check_completion_options(obj: dict[str, Any], fields: list[dict[str, Any]]) -> None:
    """業務ルールが前提にする選択肢(完了の done / open)は消せない。"""
    completion = obj.get("completion")
    if not completion:
        return
    status = next((f for f in fields if f["key"] == completion["field"]), None)
    values = {o["value"] for o in (status or {}).get("options") or []}
    for value in (completion["done_value"], completion["open_value"]):
        if value not in values:
            label = (status or {}).get("label", completion["field"])
            raise bad_request(f"「{label}」の選択肢 {value} は、完了の仕組みが使うので外せません")


def _save_field(
    conn: Connection, object_key: str, field: dict[str, Any], position: int, *, hidden: bool, existing: Any
) -> None:
    values: dict[str, Any] = {"position": position, "hidden": hidden, "updated_at": func.clock_timestamp()}
    for column in FIELD_COLUMNS:
        values[column] = bool(field.get(column)) if column in FLAG_COLUMNS else field.get(column)
    if existing is None:
        conn.execute(meta_fields.insert().values(object_key=object_key, key=field["key"], **values))
        return
    conn.execute(
        meta_fields.update()
        .where(meta_fields.c.object_key == object_key, meta_fields.c.key == field["key"])
        .values(**values)
    )


def reorder_objects(conn: Connection, keys: list[str]) -> None:
    """渡した順に先頭から並べ、渡さなかったテーブルは元の順で後ろに続ける。"""
    live = store.all_objects(conn)
    live_keys = {o["key"] for o in live}
    if any(key not in live_keys for key in keys):
        raise bad_request("無いテーブルが含まれています")
    rest = [o["key"] for o in live if o["key"] not in keys]
    for position, key in enumerate([*keys, *rest], start=1):
        conn.execute(meta_objects.update().where(meta_objects.c.key == key).values(position=position))


def delete_object(conn: Connection, key: str) -> None:
    """論理削除。レコードとビューは残り、`restore` で戻る(02 §5)。"""
    if key not in _live_keys(conn):
        raise not_found(f"テーブルがありません: {key}")
    if store.object_meta(conn, key).get("system"):
        raise bad_request("初めから入っているテーブルは削除できません")
    conn.execute(meta_objects.update().where(meta_objects.c.key == key).values(deleted_at=func.clock_timestamp()))


def restore_object(conn: Connection, key: str) -> None:
    result = conn.execute(
        meta_objects.update()
        .where(meta_objects.c.key == key, meta_objects.c.deleted_at.isnot(None))
        .values(deleted_at=None)
    )
    if result.rowcount == 0:
        raise not_found(f"削除済みのテーブルがありません: {key}")


def ensure_views(conn: Connection, obj: dict[str, Any], added: list[dict[str, Any]]) -> None:
    """足した項目がどこにも見えない、を避けるためにサーバが面倒を見る(02 §5)。

    一覧が無ければ作る。足した項目は先頭の一覧の列に加える。カンバンが無く選択肢の項目があれば作る。
    """
    mine = [v for v in store.all_views(conn) if v["object"] == obj["key"]]

    def column(field: dict[str, Any]) -> dict[str, Any]:
        width = 280 if field["key"] == obj["name_field"] else COLUMN_WIDTH.get(field["type"], 140)
        return {"field": field["key"], "width": width}

    listing = next((v for v in mine if v["type"] == "list"), None)
    if listing is None:
        columns = [column(f) for f in obj["fields"] if not f.get("readonly") and f["type"] != "textarea"][:7]
        conn.execute(
            meta_views.insert().values(
                object_key=obj["key"],
                type="list",
                name="一覧",
                position=1,
                config={
                    "columns": [*columns, {"field": "updated_at", "width": 140}],
                    "sort": [{"field": "updated_at", "dir": "desc"}],
                },
            )
        )
    elif added:
        config = dict(listing["config"])
        stamps = [c for c in config.get("columns", []) if c["field"] in ("created_at", "updated_at")]
        rest = [c for c in config.get("columns", []) if c not in stamps]
        fresh = [column(f) for f in added if f["type"] != "textarea" and all(c["field"] != f["key"] for c in rest)]
        config["columns"] = [*rest, *fresh, *stamps]
        conn.execute(meta_views.update().where(meta_views.c.id == listing["id"]).values(config=config))

    group_by = next((f for f in obj["fields"] if f["type"] == "select" and not f.get("readonly")), None)
    if group_by and not any(v["type"] == "kanban" for v in mine):
        cards = [
            f["key"]
            for f in obj["fields"]
            if not f.get("readonly")
            and f["key"] not in (obj["name_field"], group_by["key"])
            and f["type"] != "textarea"
        ]
        sum_field = next(
            (f["key"] for f in obj["fields"] if f["type"] == "currency" and f["key"] in cards),
            None,
        )
        kanban: dict[str, Any] = {
            "group_by": group_by["key"],
            "card_fields": cards[:3],
            "sort": [{"field": "updated_at", "dir": "desc"}],
        }
        if sum_field:
            kanban["sum_field"] = sum_field
        conn.execute(
            meta_views.insert().values(
                object_key=obj["key"],
                type="kanban",
                name="カンバン",
                position=max([1, *[v["position"] for v in mine]]) + 1,
                config=kanban,
            )
        )
