"""繋いだ Google アカウントの置き場(`google_accounts`)。

**refresh token と access token は暗号化して持つ**(鍵は `.env` の `WORKS_SECRET_KEY` から導く)。
DB の吸い出しだけでは Google を触れない — バックアップの退避先(Q-040)がどこでも同じ強さになる。
"""

import base64
import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Connection, delete, select

from app.google import http, oauth
from app.meta.tables import google_accounts
from app.security import app_secret

# 切れる少し前に取り直す(往復の途中で切れないように)
REFRESH_MARGIN = timedelta(seconds=60)


def _cipher() -> Fernet:
    key = hashlib.sha256(f"google-token|{app_secret()}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt(value: str) -> str:
    return _cipher().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    """鍵が変わっていれば読めない。その場合は繋ぎ直してもらう。"""
    try:
        return _cipher().decrypt(value.encode()).decode()
    except InvalidToken as exc:
        raise http.reauth_needed("保存した Google の鍵を読めませんでした。もう一度繋いでください") from exc


def get(conn: Connection, user_id: str) -> dict[str, Any] | None:
    row = conn.execute(select(google_accounts).where(google_accounts.c.user_id == user_id)).first()
    if row is None:
        return None
    return {
        "email": row.email,
        "refresh_token": row.refresh_token,
        "access_token": row.access_token,
        "expires_at": row.expires_at,
        "scope": row.scope,
    }


def status(conn: Connection, user_id: str) -> dict[str, Any]:
    account = get(conn, user_id)
    return {"connected": account is not None, "email": account["email"] if account else None}


def _expires_at(payload: dict[str, Any]) -> datetime:
    seconds = payload.get("expires_in")
    return datetime.now(UTC) + timedelta(seconds=int(seconds) if isinstance(seconds, int | str) else 3600)


def save(conn: Connection, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """token の応答を仕舞う。繋ぎ直しのときは上書き。"""
    refresh_token = payload.get("refresh_token")
    if not refresh_token:
        # access_type=offline + prompt=consent を付けているので通常は返る。返らないのは許可の出し直しが要るとき
        raise http.reauth_needed("Google から継続用の鍵をもらえませんでした。もう一度繋いでください")
    values = {
        "email": oauth.email_of(payload) or "",
        "refresh_token": encrypt(str(refresh_token)),
        "access_token": encrypt(str(payload.get("access_token", ""))),
        "expires_at": _expires_at(payload),
        "scope": str(payload.get("scope", "")),
        "updated_at": datetime.now(UTC),
    }
    exists = conn.execute(select(google_accounts.c.user_id).where(google_accounts.c.user_id == user_id)).first()
    if exists:
        conn.execute(google_accounts.update().where(google_accounts.c.user_id == user_id).values(**values))
    else:
        conn.execute(google_accounts.insert().values(user_id=user_id, **values))
    return {"connected": True, "email": values["email"]}


def disconnect(conn: Connection, user_id: str) -> None:
    account = get(conn, user_id)
    if account is None:
        return
    conn.execute(delete(google_accounts).where(google_accounts.c.user_id == user_id))
    # Google 側の許可も外す。失敗しても、こちらの行はもう消えている
    try:
        oauth.revoke(decrypt(account["refresh_token"]))
    except Exception:  # noqa: BLE001 — 解除は必ず通す
        return


def access_token(conn: Connection, user_id: str) -> str:
    """いま使える access token。切れていれば refresh token で取り直して仕舞う。"""
    account = get(conn, user_id)
    if account is None:
        raise http.reauth_needed("Google に繋いでいません。ドライブの項目から繋いでください")

    expires_at = account["expires_at"]
    if account["access_token"] and expires_at and expires_at - REFRESH_MARGIN > datetime.now(UTC):
        return decrypt(account["access_token"])

    payload = oauth.refresh_access_token(decrypt(account["refresh_token"]))
    token = str(payload.get("access_token", ""))
    if not token:
        raise http.reauth_needed()
    conn.execute(
        google_accounts.update()
        .where(google_accounts.c.user_id == user_id)
        .values(access_token=encrypt(token), expires_at=_expires_at(payload), updated_at=datetime.now(UTC))
    )
    return token
