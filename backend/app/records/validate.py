"""書き込みの検証(04 §11)。**画面・取り込み・Web フォーム・MCP のどこから来ても同じ経路を通る**(02 §5)。

正はモックの `validate` / `rejectUnknownColumns`(`frontend/src/mocks/engine.ts`)。
"""

import json
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import Connection, exists, select

from app.errors import bad_request
from app.meta import store
from app.meta.tables import users as users_table
from app.records.normalize import plain_text
from app.records.tables import table_of

DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T")
NUMERIC_TYPES = frozenset({"number", "currency", "percent"})


def known_columns(obj: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for field in obj["fields"]:
        cols = field.get("columns")
        out.update([cols["object"], cols["id"]] if cols else [field["key"]])
    return out


def reject_unknown_columns(obj: dict[str, Any], values: dict[str, Any]) -> None:
    """定義に無い列は 400(04 §11)。黙って捨てると、間違えた側が気づけない。"""
    known = known_columns(obj)
    for key in values:
        if key not in known:
            raise bad_request(f"定義に無い列です: {key}")


def _exists(conn: Connection, object_key: str, record_id: Any) -> bool:
    if not isinstance(record_id, str):
        return False
    if object_key == "users":
        return bool(conn.execute(select(exists().where(users_table.c.id == record_id))).scalar())
    try:
        target = store.object_meta(conn, object_key)
    except Exception:
        return False
    table = table_of(target)
    return bool(conn.execute(select(exists().where(table.c.id == record_id))).scalar())


def validate(conn: Connection, obj: dict[str, Any], row: dict[str, Any], keys: list[str] | None) -> dict[str, Any]:
    """値を確かめ、丸めた結果を返す(複数選択の並び直しと小数の丸めはここで行う)。"""
    out = dict(row)
    for field in obj["fields"]:
        if field.get("readonly") or field["type"] == "polymorphic":
            continue
        if keys is not None and field["key"] not in keys:
            continue
        label = field["label"]
        value = out.get(field["key"])
        if value is None or value == "":
            if field.get("required") and field["type"] != "checkbox":
                raise bad_request(f"{label}を入力してください")
            continue
        max_length = field.get("max_length")
        if max_length and isinstance(value, str):
            text = plain_text(value) if field["type"] == "richtext" else value
            if len(text) > max_length:
                raise bad_request(f"{label}は {max_length} 文字までです")
        if field["type"] == "select" and not any(o["value"] == value for o in field.get("options") or []):
            raise bad_request(f"{label}に無い選択肢です: {value}")
        if field["type"] == "multi_select":
            out[field["key"]] = _check_multi_select(field, value)
            continue
        if field["type"] in NUMERIC_TYPES:
            out[field["key"]] = _check_number(field, value)
            continue
        if field["type"] == "date" and not (isinstance(value, str) and DATE_ONLY.match(value) and _parsable(value)):
            raise bad_request(f"{label}は YYYY-MM-DD で指定してください")
        if field["type"] == "datetime" and not (isinstance(value, str) and DATETIME.match(value) and _parsable(value)):
            raise bad_request(f"{label}は ISO 8601 の日時で指定してください")
        if field["type"] == "checkbox" and not isinstance(value, bool):
            raise bad_request(f"{label}は真偽で指定してください")
        if field["type"] == "relation" and not _exists(conn, str(field.get("target")), value):
            raise bad_request(f"{label}の参照先が見つかりません")
        if field["type"] == "user" and not _exists(conn, "users", value):
            raise bad_request(f"{label}の利用者がいません")
    _validate_polymorphic(conn, obj, out, keys)
    return out


def _parsable(value: str) -> bool:
    try:
        if DATE_ONLY.fullmatch(value):
            date.fromisoformat(value)
        else:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def _check_multi_select(field: dict[str, Any], value: Any) -> str | None:
    """複数選択は選択肢の配列の JSON。**重複を除き、定義順に揃えて**保存する。"""
    label = field["label"]
    if not isinstance(value, str) or not value.startswith("["):
        raise bad_request(f"{label}は選択肢の配列で指定してください")
    try:
        items = json.loads(value)
    except json.JSONDecodeError as exc:
        raise bad_request(f"{label}は選択肢の配列で指定してください") from exc
    if not isinstance(items, list):
        raise bad_request(f"{label}は選択肢の配列で指定してください")
    options = [o["value"] for o in field.get("options") or []]
    for item in items:
        if item not in options:
            raise bad_request(f"{label}に無い選択肢です: {item}")
    ordered = [v for v in options if v in items]
    return json.dumps(ordered, ensure_ascii=False, separators=(",", ":")) if ordered else None


def _check_number(field: dict[str, Any], value: Any) -> Any:
    label = field["label"]
    if isinstance(value, bool) or not isinstance(value, int | float | Decimal):
        raise bad_request(f"{label}は数値で指定してください")
    try:
        number = Decimal(str(value))
    except InvalidOperation as exc:
        raise bad_request(f"{label}は数値で指定してください") from exc
    if not number.is_finite():
        raise bad_request(f"{label}は数値で指定してください")
    scale = field.get("scale")
    if scale is not None:
        number = number.quantize(Decimal(1).scaleb(-int(scale)))
    return int(number) if field["type"] == "currency" or scale in (None, 0) else float(number)


def _validate_polymorphic(conn: Connection, obj: dict[str, Any], row: dict[str, Any], keys: list[str] | None) -> None:
    """関連先: テーブル名は `targets` の中、ID はそのテーブルにあること。**片方だけは不可**。"""
    for field in obj["fields"]:
        if field["type"] != "polymorphic" or not field.get("columns"):
            continue
        cols = field["columns"]
        if keys is not None and cols["object"] not in keys and cols["id"] not in keys:
            continue
        target, record_id = row.get(cols["object"]), row.get(cols["id"])
        if target is None and record_id is None:
            continue
        if not isinstance(target, str) or not isinstance(record_id, str):
            raise bad_request(f"{field['label']}はテーブル名と ID を組で指定してください")
        if target not in (field.get("targets") or []):
            raise bad_request(f"{field['label']}に {target} は指定できません")
        if not _exists(conn, target, record_id):
            raise bad_request(f"{field['label']}の参照先が見つかりません")
