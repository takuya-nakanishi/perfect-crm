"""DB の値と API の値の行き来。**レコードは DB の 1 行そのまま**(02 §1)なので、名前は変えない。"""

import json
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Row


def to_api(value: Any, field: dict[str, Any] | None) -> Any:
    """1 つの列の値を、契約の形(`Scalar`)にする。"""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, Decimal):
        scale = (field or {}).get("scale") or 0
        return int(value) if scale == 0 else float(value)
    if isinstance(value, datetime):
        # ISO 8601 の UTC。画面(JS の toISOString)と同じ形に揃える
        ms = value.astimezone(UTC)
        return f"{ms.strftime('%Y-%m-%dT%H:%M:%S')}.{ms.microsecond // 1000:03d}Z"
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, list | dict):
        # 複数選択とドライブのファイルは、DB では JSONB・API では JSON の文字列(02 §2)
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return value


def row_to_api(row: Row, fields: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """1 行を丸ごと。`search_text`(検索のための内部の列)は返さない。"""
    out: dict[str, Any] = {}
    for name, value in row._mapping.items():
        if name in ("search_text", "deleted_at"):
            continue
        out[name] = to_api(value, fields.get(name))
    return out
