"""パスワードが通り、2 段目(TOTP)を待っている札(03 §5)。

札は Cookie(`__Host-works_login`)で渡し、DB(`login_challenges`)には sha256 だけを置く。
**札のあいだはセッションを作らない**(パスワードだけで入れる時間を作らない)。5 分で切れ、試せるのは 5 回まで。
"""

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Request, Response
from sqlalchemy import Connection, delete, func, select, update

from app.auth import sessions
from app.meta.tables import login_challenges

TTL = timedelta(minutes=5)
MAX_TRIES = 5


def cookie() -> str:
    return sessions.cookie_name("works_login")


def create(conn: Connection, response: Response, user_id: Any, purpose: str) -> None:
    """札を作って Cookie に置く。同じ人の古い札は捨てる(開きっぱなしの別のタブの札を残さない)。"""
    conn.execute(delete(login_challenges).where(login_challenges.c.user_id == user_id))
    conn.execute(delete(login_challenges).where(login_challenges.c.expires_at <= func.clock_timestamp()))
    token = secrets.token_urlsafe(32)
    conn.execute(
        login_challenges.insert().values(
            token_hash=sessions.token_hash(token),
            user_id=user_id,
            purpose=purpose,
            expires_at=datetime.now(UTC) + TTL,
        )
    )
    sessions.set_cookie(response, cookie(), token, TTL)


def current(conn: Connection, request: Request) -> Any | None:
    token = request.cookies.get(cookie())
    if not token:
        return None
    return conn.execute(
        select(login_challenges).where(
            login_challenges.c.token_hash == sessions.token_hash(token),
            login_challenges.c.expires_at > func.clock_timestamp(),
        )
    ).first()


def count_try(conn: Connection, token_hash: str) -> int:
    """外れた回数を 1 つ足し、足したあとの回数を返す。"""
    return int(
        conn.execute(
            update(login_challenges)
            .where(login_challenges.c.token_hash == token_hash)
            .values(attempts=login_challenges.c.attempts + 1)
            .returning(login_challenges.c.attempts)
        ).scalar_one()
    )


def finish(conn: Connection, response: Response, token_hash: str) -> None:
    conn.execute(delete(login_challenges).where(login_challenges.c.token_hash == token_hash))
    sessions.clear_cookie(response, cookie())


def drop_all(conn: Connection, user_id: Any) -> None:
    conn.execute(delete(login_challenges).where(login_challenges.c.user_id == user_id))
