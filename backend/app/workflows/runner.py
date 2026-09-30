"""送り係(04 §15)。実行記録の送信待ちを拾って、アクションを動かす。API のプロセスの中で 1 本のスレッドとして常駐する
(利用者 1〜3 名・1 プロセスの前提。03 §11)。

- **書き込みが確定した瞬間に起きる**: 実行記録を入れたトランザクションに印を付け(`wake_after_commit`)、確定したら
  送り係を起こす。取り消されたら起こさない(実行記録も残っていない)。起こし損ねても、10 秒ごとの見回りで拾う
- 取り出しは `for update skip locked`(同時に動く処理が同じ行を取らない)。取り出した行は 2 分のあいだ他が触らず、
  それを過ぎても running のままなら、取り出した処理が落ちたとみなして**もう一度動かす**(少なくとも 1 回。
  取りこぼすより二重に届くほうを取る)
- 一時的な失敗(Slack の 429・5xx・繋がらない)は 30 秒・2 分・8 分・30 分と間を空けて試し直し(`Retry-After` が
  長ければそれに従う)、5 回目でも駄目なら失敗にする
- 動かす直前にワークフローを見て、**削除・オフなら見送る**(大量に動いてしまったとき、オフにすれば残りは止まる)
- 同じ送り先へは 1.1 秒あける(Slack の Incoming Webhook は毎秒 1 件)
"""

import logging
import threading
import time
from datetime import timedelta
from typing import Any

from sqlalchemy import Connection, and_, event, func, or_, select

from app import db
from app.config import get_settings
from app.meta.tables import workflow_runs, workflows
from app.workflows.actions import Result, kinds

log = logging.getLogger("works.workflows")

POLL_SECONDS = 10.0
LOCK_SECONDS = 120
BATCH = 20
MAX_ATTEMPTS = 5
# n 回目が一時的な失敗だったときに、次を試すまでの秒数
BACKOFF = (30, 120, 480, 1800)
PACE_SECONDS = 1.1

_WAKE_KEY = "works_workflows_wake"
# 送り先ごとの最後に送った時刻(time.monotonic)
_last_at: dict[str, float] = {}


def claim(conn: Connection, limit: int = BATCH) -> list[Any]:
    """期限の来た待ち(と、取り出したまま落ちたもの)を running にして取り出す。"""
    now = func.clock_timestamp()
    due = (
        select(workflow_runs.c.id)
        .where(
            or_(
                and_(workflow_runs.c.status == "queued", workflow_runs.c.next_attempt_at <= now),
                and_(workflow_runs.c.status == "running", workflow_runs.c.locked_until < now),
            )
        )
        .order_by(workflow_runs.c.id)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    rows = conn.execute(
        workflow_runs.update()
        .where(workflow_runs.c.id.in_(due))
        .values(
            status="running",
            attempts=workflow_runs.c.attempts + 1,
            locked_until=now + timedelta(seconds=LOCK_SECONDS),
            updated_at=now,
        )
        .returning(workflow_runs)
    ).all()
    # 作った順(UUID v7)に動かす
    return sorted(rows, key=lambda r: str(r.id))


def finish(conn: Connection, run: Any, result: Result) -> None:
    now = func.clock_timestamp()
    values: dict[str, Any] = {"locked_until": None, "updated_at": now, "error": result.error, "error_code": result.code}
    if result.status == "retry" and run.attempts < MAX_ATTEMPTS:
        wait = max(BACKOFF[min(run.attempts, len(BACKOFF)) - 1], result.retry_after or 0)
        values |= {"status": "queued", "next_attempt_at": now + timedelta(seconds=wait)}
    else:
        status = "failed" if result.status == "retry" else result.status
        values |= {"status": status, "next_attempt_at": None, "finished_at": now}
        if status == "done":
            values |= {"error": None, "error_code": None}
        elif result.status == "retry" and result.error:
            values["error"] = f"{result.error}({run.attempts} 回試しました)"
    conn.execute(
        workflow_runs.update().where(workflow_runs.c.id == run.id, workflow_runs.c.status == "running").values(**values)
    )


def _pace(key: str | None) -> None:
    if key is None:
        return
    last = _last_at.get(key)
    if last is not None:
        wait = PACE_SECONDS - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
    _last_at[key] = time.monotonic()


def _run_one(run: Any) -> None:
    with db.transaction() as conn:
        found = conn.execute(
            select(workflows.c.enabled, workflows.c.deleted_at).where(workflows.c.id == run.workflow_id)
        ).first()
    if found is None or found.deleted_at is not None:
        result = Result("skipped", "ワークフローが削除されていたので、動かしませんでした", "workflow_deleted")
    elif not found.enabled:
        result = Result("skipped", "ワークフローがオフだったので、動かしませんでした", "workflow_disabled")
    else:
        kind = kinds().get(run.action_type)
        if kind is None:
            result = Result("failed", f"知らないアクションです: {run.action_type}", "unknown_action")
        else:
            _pace(kind.pace_key(run.payload))
            try:
                result = kind.execute(run.payload)
            except Exception:
                log.exception("ワークフローのアクションで思わぬ失敗(実行記録 %s)", run.id)
                result = Result("retry", "思わぬ失敗で動かせませんでした", "internal")
    with db.transaction() as conn:
        finish(conn, run, result)
    if result.status != "done":
        log.warning("ワークフローの実行記録 %s: %s %s", run.id, result.status, result.code)


def run_due(limit: int = BATCH) -> int:
    """期限の来た待ちを動かし、動かした数を返す。テストはこれを直に呼ぶ(送り係のスレッドは起こさない)。"""
    with db.transaction() as conn:
        claimed = claim(conn, limit)
    for run in claimed:
        _run_one(run)
    return len(claimed)


# --- 常駐 ---------------------------------------------------------------------------


class Runner:
    def __init__(self) -> None:
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def wake(self) -> None:
        self._wake.set()

    def start(self) -> None:
        if self._thread is not None:
            return
        engine = db.get_engine()
        event.listen(engine, "commit", _on_commit)
        event.listen(engine, "rollback", _on_rollback)
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="works-workflows", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._thread is None:
            return
        self._stop.set()
        self._wake.set()
        self._thread.join(timeout=15)
        self._thread = None
        engine = db.get_engine()
        if event.contains(engine, "commit", _on_commit):
            event.remove(engine, "commit", _on_commit)
        if event.contains(engine, "rollback", _on_rollback):
            event.remove(engine, "rollback", _on_rollback)

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                while not self._stop.is_set() and run_due():
                    pass
            except Exception:
                log.exception("送り係で思わぬ失敗")
            self._wake.wait(POLL_SECONDS)
            self._wake.clear()


_runner = Runner()


def wake_after_commit(conn: Connection) -> None:
    """このトランザクションが確定したら、送り係を起こす(取り消されたら起こさない)。"""
    conn.info[_WAKE_KEY] = True


def _on_commit(conn: Connection) -> None:
    if conn.info.pop(_WAKE_KEY, False):
        _runner.wake()


def _on_rollback(conn: Connection) -> None:
    conn.info.pop(_WAKE_KEY, None)


def start() -> None:
    """API の起動時に呼ぶ。`WORKS_WORKFLOW_RUNNER=false` なら起こさない(テスト)。"""
    if get_settings().workflow_runner:
        _runner.start()


def stop() -> None:
    _runner.stop()
