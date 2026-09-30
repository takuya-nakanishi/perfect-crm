"""ブラウザのセッション(03 §5)。

Cookie には 32 バイトの乱数を入れ、DB(`user_sessions`)には sha256 だけを置く。署名はしない(DB の行が正で、
行を消せばその場で効かなくなる)。期限はログインから 30 日で、使っていても延ばさない。
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Request, Response
from sqlalchemy import Connection, delete, func, select, update

from app.config import get_settings
from app.meta.tables import oauth_grants, user_sessions, users

SESSION_TTL = timedelta(days=30)
# 最後に使った時刻を書くのは 1 時間に 1 回まで(毎回書くと、読むだけの要求まで書き込みになる)
TOUCH_EVERY = timedelta(hours=1)
# パスワード・2 段階認証を変えるとき、いまのパスワードを求めずに済む「さっきログインした」の幅
RECENT = timedelta(minutes=10)


def _now() -> datetime:
    return datetime.now(UTC)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def cookie_name(base: str) -> str:
    """https なら `__Host-` を付ける(Secure・Path=/・Domain なしをブラウザに守らせる)。手元の http では付けられない。"""
    return f"__Host-{base}" if get_settings().secure_cookie else base


def session_cookie() -> str:
    return cookie_name("works_session")


def set_cookie(response: Response, name: str, value: str, max_age: timedelta) -> None:
    response.set_cookie(
        name,
        value,
        max_age=int(max_age.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=get_settings().secure_cookie,
        path="/",
    )


def clear_cookie(response: Response, name: str) -> None:
    response.delete_cookie(name, path="/", secure=get_settings().secure_cookie, httponly=True, samesite="lax")


def client_ip(request: Request) -> str | None:
    """Cloudflare が付ける送り元。api には Tunnel の向こうからしか届かないので信じてよい。手元は接続元。"""
    forwarded = request.headers.get("cf-connecting-ip")
    if forwarded:
        return forwarded.strip()
    return request.client.host if request.client else None


def create(conn: Connection, request: Request, response: Response, user_id: Any, method: str) -> None:
    """ログインが通ったら、新しいセッションを作って Cookie を置く(前の Cookie は引き継がない)。"""
    token = secrets.token_urlsafe(32)
    conn.execute(
        user_sessions.insert().values(
            user_id=user_id,
            token_hash=token_hash(token),
            method=method,
            expires_at=_now() + SESSION_TTL,
            user_agent=(request.headers.get("user-agent") or "")[:400] or None,
            ip=client_ip(request),
        )
    )
    conn.execute(update(users).where(users.c.id == user_id).values(last_login_at=func.clock_timestamp()))
    set_cookie(response, session_cookie(), token, SESSION_TTL)


def current(conn: Connection, request: Request) -> Any | None:
    """Cookie のセッションと、その利用者(列を合わせた 1 行)。無い・切れた・利用者が消えた → None。"""
    token = request.cookies.get(session_cookie())
    if not token:
        return None
    row = conn.execute(
        select(
            users,
            user_sessions.c.id.label("session_id"),
            user_sessions.c.created_at.label("session_created_at"),
            user_sessions.c.last_seen_at,
        )
        .join(users, users.c.id == user_sessions.c.user_id)
        .where(
            user_sessions.c.token_hash == token_hash(token),
            user_sessions.c.expires_at > func.clock_timestamp(),
            users.c.deleted_at.is_(None),
        )
    ).first()
    if row is None:
        return None
    if _now() - row.last_seen_at > TOUCH_EVERY:
        conn.execute(
            update(user_sessions)
            .where(user_sessions.c.id == row.session_id)
            .values(last_seen_at=func.clock_timestamp())
        )
    return row


def is_recent(created_at: datetime) -> bool:
    return _now() - created_at <= RECENT


def delete_current(conn: Connection, request: Request) -> None:
    token = request.cookies.get(session_cookie())
    if token:
        conn.execute(delete(user_sessions).where(user_sessions.c.token_hash == token_hash(token)))


def revoke_all(conn: Connection, user_id: Any, *, keep: Any | None = None, apps: bool = False) -> None:
    """その人のセッションを切る(`keep` だけ残す)。`apps` なら、OAuth で許可したアプリ(Android・Claude)も切る。"""
    stmt = delete(user_sessions).where(user_sessions.c.user_id == user_id)
    if keep is not None:
        stmt = stmt.where(user_sessions.c.id != keep)
    conn.execute(stmt)
    if apps:
        conn.execute(delete(oauth_grants).where(oauth_grants.c.user_id == user_id))


def sweep(conn: Connection) -> None:
    """切れたセッションを消す(ログインのたびに少しずつ)。"""
    conn.execute(delete(user_sessions).where(user_sessions.c.expires_at <= func.clock_timestamp()))


_BROWSERS = (("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"), ("Chrome/", "Chrome"), ("Safari/", "Safari"))
_SYSTEMS = (
    ("Android", "Android"),
    ("iPhone", "iPhone"),
    ("iPad", "iPad"),
    ("Windows", "Windows"),
    ("Mac OS X", "Mac"),
    ("CrOS", "ChromeOS"),
    ("Linux", "Linux"),
)


def describe(user_agent: str | None) -> str:
    """一覧に出す「Chrome · Windows」。分からなければ「ブラウザ」。"""
    ua = user_agent or ""
    browser = next((name for mark, name in _BROWSERS if mark in ua), "ブラウザ")
    system = next((name for mark, name in _SYSTEMS if mark in ua), "")
    return f"{browser} · {system}" if system else browser
