"""レコードの書き込みのたびに、動かすワークフローを決めて実行記録(送信待ち)を入れる(04 §15)。

正はモックの `fireWorkflows`(`frontend/src/mocks/workflows.ts`)。

- 呼ぶのは書き込みの経路(`app/records/service.py` の `insert` / `update`)だけ。画面・MCP・Web フォーム・CSV の
  どこから書いても同じところを通る
- **条件はビューと同じ関数で SQL にして、その 1 行に当てて判定する**(ビューと意味が食い違わない)
- 「条件を満たしたとき」は、更新の前と後で判定し、満たしていなかったものが満たした瞬間だけ動かす(作成は「前」が無い)
- 実行記録は**書き込みと同じトランザクションで**入れる。書き込みが取り消されれば実行記録も残らないので、送らない
- ワークフローの側で何が起きても、レコードの書き込みは止めない(SAVEPOINT で囲み、失敗はログに残して捨てる)
"""

import logging
from typing import Any

from sqlalchemy import Connection, func, select

from app.errors import ApiError
from app.meta import store as meta_store
from app.meta.tables import workflow_runs, workflows
from app.records.filters import Context, compile_filter
from app.records.origin import Origin
from app.records.tables import fields_by_column, table_of
from app.workflows.actions import Firing, kinds

log = logging.getLogger("works.workflows")


def _candidates(conn: Connection, obj: dict[str, Any], origin: Origin) -> list[Any]:
    """このテーブルの、いま動くワークフロー(オンで、削除されておらず、この経路の書き込みで動くもの)。"""
    rows = conn.execute(
        select(workflows)
        .where(workflows.c.object_key == obj["key"], workflows.c.enabled.is_(True), workflows.c.deleted_at.is_(None))
        .order_by(workflows.c.created_at, workflows.c.id)
    ).all()
    return [row for row in rows if origin.kind in (row.trigger.get("origins") or [])]


def _matches(conn: Connection, obj: dict[str, Any], record_id: str, filter_: Any) -> bool:
    """その 1 行が条件を満たすか。条件が無ければ満たす。**条件を評価できない**(無い項目を指している)なら満たさない
    (条件を外して動かすと、思っていたより広く動く)。"""
    table = table_of(obj)
    where = [table.c.id == record_id, table.c.deleted_at.is_(None)]
    if filter_:
        timezone = meta_store.get_workspace(conn)["timezone"]
        try:
            condition = compile_filter(table, fields_by_column(obj), filter_, Context(timezone=timezone, me=None))
        except ApiError:
            return False
        if condition is not None:
            where.append(condition)
    return conn.execute(select(table.c.id).where(*where)).first() is not None


def _enqueue(
    conn: Connection, row: Any, obj: dict[str, Any], record: dict[str, Any], event: str, origin: Origin
) -> None:
    known = kinds()
    firing = Firing(str(row.id), row.name, obj, record, event, origin)
    name = str(record.get(obj["name_field"]) or "").strip() or "(名前なし)"
    for action in row.actions or []:
        kind = known.get(action.get("type"))
        if kind is None:
            continue
        conn.execute(
            workflow_runs.insert().values(
                workflow_id=row.id,
                action_id=action["id"],
                action_type=action["type"],
                object_key=obj["key"],
                record_id=record["id"],
                record_name=name,
                event=event,
                origin=origin.kind,
                actor_id=origin.actor,
                status="queued",
                next_attempt_at=func.clock_timestamp(),
                payload=kind.prepare(conn, firing, action),
            )
        )
    from app.workflows import runner

    runner.wake_after_commit(conn)


def _guarded(conn: Connection, what: str, fn: Any) -> Any:
    """ワークフローの側の失敗で、レコードの書き込みを止めない。"""
    savepoint = conn.begin_nested()
    try:
        result = fn()
    except Exception:
        savepoint.rollback()
        log.exception("ワークフローの%sで思わぬ失敗(レコードの書き込みは続ける)", what)
        return None
    savepoint.commit()
    return result


def after_insert(conn: Connection, obj: dict[str, Any], record: dict[str, Any], origin: Origin) -> None:
    """作ったあと。「作成されたとき」は条件(あれば)を満たせば、「条件を満たしたとき」は満たせば動く。"""

    def fire() -> None:
        for row in _candidates(conn, obj, origin):
            event = row.trigger.get("event")
            if event not in ("created", "matched"):
                continue
            if _matches(conn, obj, record["id"], row.trigger.get("filter")):
                _enqueue(conn, row, obj, record, event, origin)

    _guarded(conn, "判定", fire)


def before_update(conn: Connection, obj: dict[str, Any], record_id: str, origin: Origin) -> set[str]:
    """更新の前に、「条件を満たしたとき」のワークフローのうち、もう満たしているものを覚えておく。"""

    def snapshot() -> set[str]:
        return {
            str(row.id)
            for row in _candidates(conn, obj, origin)
            if row.trigger.get("event") == "matched" and _matches(conn, obj, record_id, row.trigger.get("filter"))
        }

    return _guarded(conn, "判定", snapshot) or set()


def after_update(
    conn: Connection, obj: dict[str, Any], record: dict[str, Any], origin: Origin, before: set[str]
) -> None:
    """更新のあと。前は満たしておらず、いま満たす「条件を満たしたとき」だけ動く。"""

    def fire() -> None:
        for row in _candidates(conn, obj, origin):
            if row.trigger.get("event") != "matched" or str(row.id) in before:
                continue
            if _matches(conn, obj, record["id"], row.trigger.get("filter")):
                _enqueue(conn, row, obj, record, "matched", origin)

    _guarded(conn, "判定", fire)
