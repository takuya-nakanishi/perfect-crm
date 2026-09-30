"""ワークフローの定義(`workflows`)と実行記録(`workflow_runs`)の読み書き(04 §15)。"""

from datetime import datetime
from typing import Any

from sqlalchemy import Connection, func, select

from app.errors import bad_request, conflict, not_found
from app.meta import store as meta_store
from app.meta.tables import workflow_runs, workflows
from app.slack.store import valid_id
from app.workflows import model
from app.workflows.actions import kinds

# 実行記録の一覧の上限
MAX_RUNS = 200


def _iso(value: datetime | None) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


def _run_dict(conn: Connection, row: Any) -> dict[str, Any]:
    kind = kinds().get(row.action_type)
    return {
        "id": str(row.id),
        "workflow_id": str(row.workflow_id),
        "action_id": row.action_id,
        "action_type": row.action_type,
        "object": row.object_key,
        "record_id": str(row.record_id),
        "record_name": row.record_name,
        "event": row.event,
        "origin": row.origin,
        "actor_id": str(row.actor_id) if row.actor_id else None,
        "status": row.status,
        "attempts": row.attempts,
        "error": row.error,
        "target": kind.target(conn, row.payload) if kind else None,
        "created_at": _iso(row.created_at),
        "next_attempt_at": _iso(row.next_attempt_at) if row.status == "queued" else None,
        "finished_at": _iso(row.finished_at),
    }


def problems(conn: Connection, row: Any, objects: dict[str, dict[str, Any]]) -> list[str]:
    """いま動けない理由(画面に出す)。空なら動ける。"""
    obj = objects.get(row.object_key)
    if obj is None:
        return ["テーブルが削除されています。テーブルを元に戻すと動きます"]
    out: list[str] = []
    columns = set(meta_store.view_field_keys(obj))
    missing = [key for key in model.filter_fields(row.trigger.get("filter")) if key not in columns]
    if missing:
        out.append(f"条件の項目 {', '.join(missing)} がありません。条件を直すまで動きません")
    known = kinds()
    for action in row.actions or []:
        kind = known.get(action.get("type"))
        out += kind.problems(conn, obj, action) if kind else [f"知らないアクションです: {action.get('type')}"]
    return out


def _last_runs(conn: Connection) -> dict[str, dict[str, Any]]:
    """ワークフローごとの直近の実行(一覧に出す)。"""
    latest = (
        select(workflow_runs)
        .distinct(workflow_runs.c.workflow_id)
        .order_by(workflow_runs.c.workflow_id, workflow_runs.c.created_at.desc(), workflow_runs.c.id.desc())
    )
    out: dict[str, dict[str, Any]] = {}
    for row in conn.execute(latest):
        out[str(row.workflow_id)] = {
            "status": row.status,
            "at": _iso(row.finished_at or row.created_at),
            "error": row.error,
        }
    return out


def _dict(
    conn: Connection, row: Any, objects: dict[str, dict[str, Any]], last: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name,
        "enabled": row.enabled,
        "object": row.object_key,
        "trigger": row.trigger,
        "actions": row.actions,
        "created_by": str(row.created_by) if row.created_by else None,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
        "last_run": last.get(str(row.id)),
        "problems": problems(conn, row, objects),
    }


def _objects(conn: Connection) -> dict[str, dict[str, Any]]:
    return {o["key"]: o for o in meta_store.live_objects(conn)}


def list_all(conn: Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        select(workflows).where(workflows.c.deleted_at.is_(None)).order_by(workflows.c.created_at, workflows.c.id)
    )
    objects = _objects(conn)
    last = _last_runs(conn)
    return [_dict(conn, row, objects, last) for row in rows]


def _row(conn: Connection, workflow_id: str, *, deleted: bool = False) -> Any:
    found = valid_id(workflow_id)
    row = None
    if found is not None:
        stmt = select(workflows).where(workflows.c.id == found)
        stmt = stmt.where(workflows.c.deleted_at.isnot(None) if deleted else workflows.c.deleted_at.is_(None))
        row = conn.execute(stmt).first()
    if row is None:
        raise not_found("ワークフローがありません")
    return row


def get(conn: Connection, workflow_id: str) -> dict[str, Any]:
    return _dict(conn, _row(conn, workflow_id), _objects(conn), _last_runs(conn))


def create(conn: Connection, body: dict[str, Any], user_id: str) -> dict[str, Any]:
    values = model.check(conn, body)
    row = conn.execute(workflows.insert().values(**values, created_by=user_id).returning(workflows)).one()
    return get(conn, str(row.id))


def update(conn: Connection, workflow_id: str, body: dict[str, Any]) -> dict[str, Any]:
    row = _row(conn, workflow_id)
    values = model.check(conn, body)
    conn.execute(workflows.update().where(workflows.c.id == row.id).values(**values, updated_at=func.clock_timestamp()))
    return get(conn, str(row.id))


def delete(conn: Connection, workflow_id: str) -> None:
    """論理削除。実行記録は残り、`restore` で戻る。まだ送っていない分は、送り係が見送りにする。"""
    row = _row(conn, workflow_id)
    conn.execute(
        workflows.update()
        .where(workflows.c.id == row.id)
        .values(deleted_at=func.clock_timestamp(), updated_at=func.clock_timestamp())
    )


def restore(conn: Connection, workflow_id: str) -> dict[str, Any]:
    row = _row(conn, workflow_id, deleted=True)
    conn.execute(workflows.update().where(workflows.c.id == row.id).values(deleted_at=None))
    return get(conn, str(row.id))


def runs(conn: Connection, workflow_id: str, limit: int = 50) -> list[dict[str, Any]]:
    row = _row(conn, workflow_id)
    stmt = (
        select(workflow_runs)
        .where(workflow_runs.c.workflow_id == row.id)
        .order_by(workflow_runs.c.created_at.desc(), workflow_runs.c.id.desc())
        .limit(max(1, min(limit, MAX_RUNS)))
    )
    return [_run_dict(conn, r) for r in conn.execute(stmt)]


def retry(conn: Connection, run_id: str) -> dict[str, Any]:
    """失敗・見送りの実行を、もう一度送る(待ちへ戻す)。送った・待っているものは 409。"""
    found = valid_id(run_id)
    row = conn.execute(select(workflow_runs).where(workflow_runs.c.id == found)).first() if found else None
    if row is None:
        raise not_found("実行記録がありません")
    if row.status not in ("failed", "skipped"):
        raise conflict("この実行は、送り直せる状態ではありません(失敗か見送りのものだけ)", "not_retryable")
    alive = conn.execute(
        select(workflows.c.id).where(workflows.c.id == row.workflow_id, workflows.c.deleted_at.is_(None))
    ).first()
    if alive is None:
        raise bad_request("ワークフローが削除されています。元に戻してから送り直してください")
    updated = conn.execute(
        workflow_runs.update()
        .where(workflow_runs.c.id == row.id)
        .values(
            status="queued",
            attempts=0,
            next_attempt_at=func.clock_timestamp(),
            locked_until=None,
            error=None,
            error_code=None,
            finished_at=None,
            updated_at=func.clock_timestamp(),
        )
        .returning(workflow_runs)
    ).one()
    from app.workflows import runner

    runner.wake_after_commit(conn)
    return _run_dict(conn, updated)
