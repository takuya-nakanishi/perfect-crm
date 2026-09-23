"""環境設定(04 §10)。MCP のアクセストークンと Web フォーム。**管理者だけ**が触れる(03 §5)。

トークンは**全文を保存しない**。照合は sha256(高いエントロピーの乱数なので、
パスワードのような遅いハッシュは要らない。人が選ぶ文字列ではないため辞書攻撃が効かない)。
"""

import hashlib
import re
import secrets
from typing import Any

from sqlalchemy import Connection, func, select

from app.errors import bad_request, not_found
from app.meta import store
from app.meta.tables import mcp_tokens, web_forms

# 読み違えにくい字だけ(0/o/1/l を外す)
ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"
CLIENTS = ("claude-desktop", "claude-code", "codex", "other")
URL_PATTERN = re.compile(r"^https?://")


def random_key(length: int) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def hash_token(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _token_dict(row: Any) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name,
        "client": row.client,
        "prefix": row.prefix,
        "created_by": str(row.created_by) if row.created_by else None,
        "created_at": row.created_at.isoformat().replace("+00:00", "Z"),
        "last_used_at": row.last_used_at.isoformat().replace("+00:00", "Z") if row.last_used_at else None,
    }


def list_tokens(conn: Connection) -> list[dict[str, Any]]:
    rows = conn.execute(select(mcp_tokens).order_by(mcp_tokens.c.created_at.desc()))
    return [_token_dict(row) for row in rows]


def create_token(conn: Connection, name: str, client: str, me: str) -> dict[str, Any]:
    if not name.strip():
        raise bad_request("トークンの名前を入力してください")
    if client not in CLIENTS:
        raise bad_request(f"知らないアプリです: {client}")
    secret = f"wks_{random_key(40)}"
    row = conn.execute(
        mcp_tokens.insert()
        .values(
            name=name.strip(),
            client=client,
            prefix=secret[:8],
            token_hash=hash_token(secret),
            created_by=me,
        )
        .returning(mcp_tokens)
    ).one()
    # 全文を返すのはこの応答だけ(04 §10)
    return {"token": _token_dict(row), "secret": secret}


def revoke_token(conn: Connection, token_id: str) -> None:
    result = conn.execute(mcp_tokens.delete().where(mcp_tokens.c.id == token_id))
    if result.rowcount == 0:
        raise not_found("トークンがありません")


def verify_token(conn: Connection, secret: str) -> dict[str, Any] | None:
    """MCP サーバ(J-028)が `Authorization: Bearer` で受けたトークンを照合し、最終利用を記録する。"""
    row = conn.execute(select(mcp_tokens).where(mcp_tokens.c.token_hash == hash_token(secret))).first()
    if row is None:
        return None
    conn.execute(mcp_tokens.update().where(mcp_tokens.c.id == row.id).values(last_used_at=func.clock_timestamp()))
    return _token_dict(row)


def _form_dict(row: Any) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name,
        "object": row.object_key,
        "fields": row.fields,
        "defaults": row.defaults,
        "key": row.key,
        "enabled": row.enabled,
        "redirect_url": row.redirect_url,
        "created_at": row.created_at.isoformat().replace("+00:00", "Z"),
        "submissions": row.submissions,
        "last_submitted_at": row.last_submitted_at.isoformat().replace("+00:00", "Z")
        if row.last_submitted_at
        else None,
    }


def _check_form(conn: Connection, body: dict[str, Any]) -> dict[str, Any]:
    if not str(body.get("name") or "").strip():
        raise bad_request("フォームの名前を入力してください")
    objects = {o["key"]: o for o in store.all_objects(conn)}
    obj = objects.get(str(body.get("object")))
    if obj is None:
        raise bad_request("テーブルを選んでください")
    fields = list(body.get("fields") or [])
    if not fields:
        raise bad_request("受け付ける項目を 1 つ以上選んでください")
    by_key = {f["key"]: f for f in obj["fields"]}
    for key in fields:
        field = by_key.get(key)
        if field is None or field.get("readonly") or field["type"] in ("polymorphic", "drive_files"):
            raise bad_request(f"受け付けられない項目です: {key}")
    redirect = body.get("redirect_url")
    if redirect and not URL_PATTERN.match(str(redirect)):
        raise bad_request("戻り先の URL は http(s) で始めてください")
    return obj


def list_forms(conn: Connection) -> list[dict[str, Any]]:
    rows = conn.execute(select(web_forms).order_by(web_forms.c.created_at.desc()))
    return [_form_dict(row) for row in rows]


def create_form(conn: Connection, body: dict[str, Any]) -> dict[str, Any]:
    _check_form(conn, body)
    row = conn.execute(
        web_forms.insert()
        .values(
            name=str(body["name"]).strip(),
            object_key=body["object"],
            fields=body["fields"],
            defaults=body.get("defaults") or {},
            key=random_key(10),
            enabled=body.get("enabled", True),
            redirect_url=body.get("redirect_url"),
        )
        .returning(web_forms)
    ).one()
    return _form_dict(row)


def update_form(conn: Connection, form_id: str, body: dict[str, Any]) -> dict[str, Any]:
    _check_form(conn, body)
    row = conn.execute(
        web_forms.update()
        .where(web_forms.c.id == form_id)
        .values(
            name=str(body["name"]).strip(),
            object_key=body["object"],
            fields=body["fields"],
            defaults=body.get("defaults") or {},
            enabled=body.get("enabled", True),
            redirect_url=body.get("redirect_url"),
        )
        .returning(web_forms)
    ).first()
    if row is None:
        raise not_found("フォームがありません")
    return _form_dict(row)


def delete_form(conn: Connection, form_id: str) -> None:
    conn.execute(web_forms.delete().where(web_forms.c.id == form_id))


def rotate_key(conn: Connection, form_id: str) -> dict[str, Any]:
    """受け口の URL に入る秘密を作り直す(古い URL は 404 になる)。"""
    row = conn.execute(
        web_forms.update().where(web_forms.c.id == form_id).values(key=random_key(10)).returning(web_forms)
    ).first()
    if row is None:
        raise not_found("フォームがありません")
    return _form_dict(row)
