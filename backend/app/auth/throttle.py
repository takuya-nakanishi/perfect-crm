"""続けて失敗したときの待ちと、ログインの試みの記録(03 §5)。数えるのは `login_attempts`。

- 同じアカウントで 5 回続けて失敗したら、次を受けるまで待たせる。待ちは 1 分から倍々で、上限 1 時間。
  アカウントを閉じてはしまわない(閉じると、他人が本人を締め出せる)。どの方法でも、ログインが通れば数え直す
- 100 回続けて失敗したら、パスワードでのログインを止める(NIST の上限)。Google で入るか、`set-password` で戻る
- 同じ IP から 10 分に 30 回失敗したら、その IP からは受けない(古い失敗が 10 分より前になるまで)
- 待たせている間の試みは、照らさず(ハッシュを掛けず)、数にも入れない。記録は同じ送り元から 1 分に 1 件だけ
  (門が無く、だれからでも届くので、叩き続けられても表を膨らませない)
"""

import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Connection, delete, func, or_, select

from app.meta.tables import login_attempts, users

FREE_FAILURES = 5
FIRST_WAIT = timedelta(minutes=1)
MAX_WAIT = timedelta(hours=1)
LOCK_FAILURES = 100
IP_WINDOW = timedelta(minutes=10)
IP_FAILURES = 30
KEEP = timedelta(days=90)
# 数える失敗の理由(待たせて断ったもの `throttled` は数えない)
COUNTED = ("no_user", "bad_password", "bad_code")
# 待たせて断った試みを残す間隔(同じ送り元から、この間に 1 件だけ)
THROTTLED_EVERY = timedelta(minutes=1)

_last_sweep = 0.0


@dataclass
class Wait:
    message: str
    # 何秒後に試せるか。None は「待っても戻らない」(パスワードでのログインを止めた)
    retry_after: int | None


def _now() -> datetime:
    return datetime.now(UTC)


def record(
    conn: Connection,
    *,
    email: str,
    user_id: Any | None,
    method: str,
    ip: str | None,
    succeeded: bool,
    reason: str | None = None,
) -> None:
    global _last_sweep
    conn.execute(
        login_attempts.insert().values(
            email=email, user_id=user_id, method=method, ip=ip, succeeded=succeeded, reason=reason
        )
    )
    # 90 日より前の記録は、1 時間に 1 回まとめて消す
    if time.monotonic() - _last_sweep > 3600:
        _last_sweep = time.monotonic()
        conn.execute(delete(login_attempts).where(login_attempts.c.created_at < func.clock_timestamp() - KEEP))


def record_throttled(conn: Connection, *, email: str, user_id: Any | None, method: str, ip: str | None) -> None:
    """待たせて断った試みを残す。同じ送り元(IP。分からなければメールアドレス)からは 1 分に 1 件だけ。"""
    same = login_attempts.c.ip == ip if ip else login_attempts.c.email == email
    recent = conn.execute(
        select(login_attempts.c.id)
        .where(
            login_attempts.c.reason == "throttled",
            same,
            login_attempts.c.created_at > func.clock_timestamp() - THROTTLED_EVERY,
        )
        .limit(1)
    ).first()
    if recent is None:
        record(conn, email=email, user_id=user_id, method=method, ip=ip, succeeded=False, reason="throttled")


def _minutes(seconds: float) -> str:
    minutes = max(1, int(seconds + 59) // 60)
    return f"{minutes} 分"


def check(conn: Connection, *, user_id: Any | None, ip: str | None) -> Wait | None:
    """いま試してよいか。待たせるなら `Wait`。"""
    if user_id is not None:
        wait = _check_account(conn, user_id)
        if wait:
            return wait
    if ip:
        return _check_ip(conn, ip)
    return None


def _check_account(conn: Connection, user_id: Any) -> Wait | None:
    # 数え直すのは、最後にログインが通った時刻か、パスワードを決め直した時刻から
    last_success = (
        select(func.max(login_attempts.c.created_at))
        .where(login_attempts.c.user_id == user_id, login_attempts.c.succeeded.is_(True))
        .scalar_subquery()
    )
    changed = select(users.c.password_changed_at).where(users.c.id == user_id).scalar_subquery()
    since = func.greatest(last_success, changed)
    row = conn.execute(
        select(func.count(), func.max(login_attempts.c.created_at)).where(
            login_attempts.c.user_id == user_id,
            login_attempts.c.succeeded.is_(False),
            login_attempts.c.reason.in_(COUNTED),
            or_(since.is_(None), login_attempts.c.created_at > since),
        )
    ).one()
    failures, last_failure = int(row[0]), row[1]
    if failures >= LOCK_FAILURES:
        return Wait(
            "続けて失敗したため、パスワードでのログインを止めています。Google で入り直すか、管理者に頼んでください",
            None,
        )
    if failures < FREE_FAILURES or last_failure is None:
        return None
    wait = min(MAX_WAIT, FIRST_WAIT * (2 ** (failures - FREE_FAILURES)))
    left = (last_failure + wait - _now()).total_seconds()
    if left <= 0:
        return None
    return Wait(f"続けて失敗したため、{_minutes(left)}ほど待ってからもう一度お試しください", int(left) + 1)


def _check_ip(conn: Connection, ip: str) -> Wait | None:
    recent = (
        conn.execute(
            select(login_attempts.c.created_at)
            .where(
                login_attempts.c.ip == ip,
                login_attempts.c.succeeded.is_(False),
                login_attempts.c.reason.in_(COUNTED),
                login_attempts.c.created_at > func.clock_timestamp() - IP_WINDOW,
            )
            .order_by(login_attempts.c.created_at.desc())
            .limit(IP_FAILURES)
        )
        .scalars()
        .all()
    )
    if len(recent) < IP_FAILURES:
        return None
    # 並びの最後(30 件目)が 10 分より前になれば、また受ける
    left = (recent[-1] + IP_WINDOW - _now()).total_seconds()
    if left <= 0:
        return None
    return Wait(f"この場所からの失敗が続いたため、{_minutes(left)}ほど待ってからもう一度お試しください", int(left) + 1)
