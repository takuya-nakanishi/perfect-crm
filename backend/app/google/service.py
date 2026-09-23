"""ドライブの項目に対する操作(04 §8)。画面・MCP のどちらから来ても、ここを通る。"""

import json
from typing import Any

from sqlalchemy import Connection

from app.config import get_settings
from app.errors import ApiError, bad_request
from app.google import drive, oauth, store
from app.meta import store as meta_store
from app.records import service as records


def require_configured() -> None:
    """OAuth クライアントが `.env` に無ければ、繋ぐことも叩くこともできない。"""
    if not get_settings().google_enabled:
        raise ApiError(
            503,
            "google_not_configured",
            "Google 連携が設定されていません(管理者が .env の WORKS_GOOGLE_CLIENT_ID / SECRET を入れてください)",
        )


def connect_url(user_id: str) -> dict[str, str]:
    require_configured()
    return {"url": oauth.authorize_url(user_id)}


def complete(conn: Connection, code: str, state: str) -> dict[str, Any]:
    """Google から戻ってきたところ。state が本物なら token を取りに行って仕舞う。"""
    require_configured()
    user_id = oauth.read_state(state)
    payload = oauth.exchange_code(code, state)
    return store.save(conn, user_id, payload)


def list_files(conn: Connection, user_id: str, q: str) -> list[dict[str, str]]:
    require_configured()
    return drive.search(store.access_token(conn, user_id), q)


def _drive_field(obj: dict[str, Any], field_key: str) -> dict[str, Any]:
    field = next((f for f in obj["fields"] if f["key"] == field_key), None)
    if field is None or field["type"] != "drive_files":
        raise bad_request("Google ドライブの項目ではありません")
    return field


def _values(raw: Any) -> list[dict[str, Any]]:
    """項目の値(JSON の文字列)を読む。壊れていれば空(画面の `parseDriveFiles` と同じ扱い)。"""
    if not isinstance(raw, str) or not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [f for f in parsed if isinstance(f, dict) and isinstance(f.get("id"), str) and isinstance(f.get("url"), str)]


def create_document(conn: Connection, user_id: str, object_key: str, record_id: str, field_key: str) -> dict[str, Any]:
    """レコード名の Google ドキュメントを作り、項目の**末尾**に付ける。応答は更新後のレコード。"""
    require_configured()
    obj = meta_store.object_meta(conn, object_key)
    _drive_field(obj, field_key)
    current = records.find(conn, object_key, record_id)["record"]
    name = str(current.get(obj["name_field"]) or "") or "名称未設定"

    file = drive.create_document(store.access_token(conn, user_id), object_label=obj["label"], name=name)
    next_value = [*_values(current.get(field_key)), file]
    return records.update(conn, object_key, record_id, {field_key: json.dumps(next_value, ensure_ascii=False)}, user_id)
