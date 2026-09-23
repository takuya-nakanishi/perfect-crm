"""CSV の取り込みと書き出し(04 §7)。正はモックの `frontend/src/mocks/csv.ts`。

**文字から値への変換はサーバの仕事**。同じ `coerce` を Web フォームの受け口(04 §10)も使う。
"""

import csv
import io
import json
import re
import unicodedata
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, select

from app.errors import bad_request
from app.meta import store
from app.meta.tables import users as users_table
from app.records import service
from app.records.normalize import normalize_text, plain_text
from app.records.refs import display_value
from app.records.tables import table_of

TRUE_WORDS = {"true", "1", "yes", "y", "はい", "○", "〇", "✓", "on"}
UUID_PATTERN = re.compile(r"^[0-9a-f-]{36}$")
DATE_PATTERN = re.compile(r"^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(.*)$")
TIME_PATTERN = re.compile(r"\d{1,2}:\d{2}")
NUMBER_TRASH = re.compile(r"[¥,\s%円]")
MULTI_SEPARATOR = re.compile(r"[、,;/]")


class RowError(Exception):
    """その行だけ飛ばす理由(取り込みは読める行だけを入れる)。"""


def parse_csv(text: str) -> list[list[str]]:
    """RFC 4180 相当。タブ区切り(Excel からの貼り付け)も受ける。空だけの行は落とす。"""
    src = text.lstrip("﻿")
    first = src.split("\n", 1)[0]
    delimiter = "\t" if "," not in first and "\t" in src else ","
    rows = list(csv.reader(io.StringIO(src, newline=""), delimiter=delimiter))
    return [row for row in rows if any(cell.strip() for cell in row)]


def to_csv(rows: list[list[str]]) -> str:
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerows(rows)
    return out.getvalue()


def importable_fields(obj: dict[str, Any]) -> list[dict[str, Any]]:
    return [f for f in obj["fields"] if not f.get("readonly") and f["type"] not in ("polymorphic", "drive_files")]


def coerce(conn: Connection, field: dict[str, Any], raw: str, timezone: str) -> Any:
    """文字を項目の型の値にする。直せなければ `RowError`。"""
    text = raw.strip()
    label = field["label"]
    if text == "":
        return None
    ftype = field["type"]
    if ftype in ("number", "currency", "percent"):
        cleaned = NUMBER_TRASH.sub("", unicodedata.normalize("NFKC", text))
        try:
            number = float(cleaned)
        except ValueError as exc:
            raise RowError(f"{label}「{text}」は数値ではありません") from exc
        return int(number) if number.is_integer() else number
    if ftype in ("date", "datetime"):
        return _coerce_date(field, text, timezone)
    if ftype == "checkbox":
        return text.lower() in TRUE_WORDS
    if ftype == "multi_select":
        return _coerce_multi_select(field, text)
    if ftype == "select":
        option = _find_option(field, text)
        if option is None:
            raise RowError(f"{label}に「{text}」という選択肢はありません")
        return option["value"]
    if ftype == "user":
        return _coerce_user(conn, label, text)
    if ftype == "relation":
        return _coerce_relation(conn, field, text)
    if ftype == "richtext":
        # 素の文字を段落にする(改行は段落の区切り)
        escaped = (line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") for line in text.splitlines())
        return "".join(f"<p>{line}</p>" for line in escaped)
    return text


def _find_option(field: dict[str, Any], text: str) -> dict[str, Any] | None:
    for option in field.get("options") or []:
        if option["label"] == text or option["value"] == text:
            return option
    return None


def _coerce_date(field: dict[str, Any], text: str, timezone: str) -> str | None:
    matched = DATE_PATTERN.match(unicodedata.normalize("NFKC", text))
    if not matched:
        raise RowError(f"{field['label']}「{text}」は日付として読めません")
    day = f"{matched.group(1)}-{int(matched.group(2)):02d}-{int(matched.group(3)):02d}"
    if field["type"] == "date":
        return day
    found = TIME_PATTERN.search(matched.group(4) or "")
    clock = found.group() if found else "00:00"
    hour, _, minute = clock.partition(":")
    try:
        local = datetime.fromisoformat(f"{day}T{int(hour):02d}:{minute}:00").replace(tzinfo=ZoneInfo(timezone))
    except ValueError:
        return None
    # 契約の日時は ISO 8601 の UTC(04 §1)
    return local.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")


def _coerce_multi_select(field: dict[str, Any], text: str) -> str | None:
    values: list[str] = []
    for part in MULTI_SEPARATOR.split(text):
        item = part.strip()
        if not item:
            continue
        option = _find_option(field, item)
        if option is None:
            raise RowError(f"{field['label']}に「{item}」という選択肢はありません")
        if option["value"] not in values:
            values.append(option["value"])
    return json.dumps(values, ensure_ascii=False, separators=(",", ":")) if values else None


def _coerce_user(conn: Connection, label: str, text: str) -> str:
    row = conn.execute(
        select(users_table.c.id).where(
            (users_table.c.name == text) | (users_table.c.email == text.lower()),
            users_table.c.deleted_at.is_(None),
        )
    ).first()
    if row is None:
        raise RowError(f"{label}「{text}」という利用者はいません")
    return str(row.id)


def _coerce_relation(conn: Connection, field: dict[str, Any], text: str) -> str | None:
    target_key = field.get("target")
    if not target_key:
        return None
    target = store.object_meta(conn, target_key)
    table = table_of(target)
    if UUID_PATTERN.match(text):
        # UUID ならそのまま(移行や再実行で、名前でなく ID で指せる)
        found = conn.execute(select(table.c.id).where(table.c.id == text)).first()
        if found is not None:
            return str(found.id)
    needle = normalize_text(text)
    rows = conn.execute(select(table.c.id, table.c[target["name_field"]]).where(table.c.deleted_at.is_(None)))
    hits = [str(row.id) for row in rows if normalize_text(str(row[1] or "")) == needle]
    if not hits:
        raise RowError(f"{target['label']}「{text}」が見つかりません")
    if len(hits) > 1:
        # 同名が複数なら黙って選ばない(誤って結ぶより、行を止めて ID で指してもらう)
        raise RowError(f"{target['label']}「{text}」が {len(hits)} 件あります。ID で指定してください")
    return hits[0]


def guess_field(obj: dict[str, Any], header: str) -> str | None:
    needle = normalize_text(header)
    for field in importable_fields(obj):
        if normalize_text(field["label"]) == needle or field["key"] == header.strip().lower():
            return str(field["key"])
    return None


def import_csv(conn: Connection, object_key: str, params: dict[str, Any], me: str | None) -> dict[str, Any]:
    obj = store.object_meta(conn, object_key)
    timezone = store.get_workspace(conn)["timezone"]
    rows = parse_csv(str(params.get("csv") or ""))
    if not rows:
        raise bad_request("CSV に中身がありません")
    headers, lines = rows[0], rows[1:]
    fields = {f["key"]: f for f in importable_fields(obj)}

    given = params.get("mapping") or {}
    mapping: dict[str, str | None] = {}
    for header in headers:
        chosen = given[header] if header in given else guess_field(obj, header)
        # 同じ項目へ 2 つの列を当てない(先に出た列が勝つ)
        mapping[header] = chosen if chosen in fields and chosen not in mapping.values() else None

    errors: list[dict[str, Any]] = []
    accepted: list[dict[str, Any]] = []
    for index, cells in enumerate(lines):
        try:
            values = _row_values(conn, headers, cells, mapping, fields, timezone)
            accepted.append(values)
        except RowError as exc:
            errors.append({"line": index + 2, "message": str(exc)})

    created_ids: list[str] = []
    if not params.get("dry_run"):
        # 一覧の並び(新しいものが上)が CSV の並びと揃うよう、後ろから入れる
        for values in reversed(accepted):
            created = service.insert(conn, object_key, values, me)
            created_ids.insert(0, created["record"]["id"])
    return {
        "headers": headers,
        "mapping": mapping,
        "total": len(lines),
        "valid": len(accepted),
        "errors": errors[:20],
        "sample": lines[:5],
        "created_ids": created_ids,
    }


def _row_values(
    conn: Connection,
    headers: list[str],
    cells: list[str],
    mapping: dict[str, str | None],
    fields: dict[str, dict[str, Any]],
    timezone: str,
) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for column, header in enumerate(headers):
        field = fields.get(mapping.get(header) or "")
        if field:
            values[field["key"]] = coerce(conn, field, cells[column] if column < len(cells) else "", timezone)
    for field in fields.values():
        empty = values.get(field["key"]) is None
        # 必須の選択肢と担当は、作成時にサーバが既定値を入れるので空でよい
        if field.get("required") and empty and field["type"] not in ("select", "checkbox"):
            raise RowError(f"{field['label']}が空です")
        max_length = field.get("max_length")
        value = values.get(field["key"])
        if max_length and isinstance(value, str) and len(value) > max_length:
            raise RowError(f"{field['label']}が {max_length} 文字を超えています")
    return {key: value for key, value in values.items() if value is not None}


def export_csv(conn: Connection, object_key: str, params: dict[str, Any], me: str | None) -> bytes:
    obj = store.object_meta(conn, object_key)
    listed = service.query(conn, object_key, {**params, "limit": None, "offset": None}, me)
    lines = [[f["label"] for f in obj["fields"]]]
    for record in listed["records"]:
        lines.append([_export_value(conn, obj, field, record) for field in obj["fields"]])
    # 先頭の BOM は、Excel が UTF-8 として開くための印
    return ("﻿" + to_csv(lines)).encode("utf-8")


def _export_value(conn: Connection, obj: dict[str, Any], field: dict[str, Any], record: dict[str, Any]) -> str:
    if field["type"] == "polymorphic" and field.get("columns"):
        from app.records.refs import ref_of

        target = record.get(field["columns"]["object"])
        target_id = record.get(field["columns"]["id"])
        if isinstance(target, str) and target_id:
            return ref_of(conn, target, [str(target_id)]).get(str(target_id), {}).get("name", "")
        return ""
    if field["type"] == "checkbox":
        return "はい" if record.get(field["key"]) else ""
    if field["type"] == "richtext":
        value = record.get(field["key"])
        return plain_text(value) if isinstance(value, str) else ""
    if field["type"] == "drive_files":
        value = record.get(field["key"])
        files = json.loads(value) if isinstance(value, str) and value else []
        return "\n".join(f"{f.get('name', '')} {f.get('url', '')}" for f in files)
    return display_value(conn, obj, record, field["key"]) or ""
