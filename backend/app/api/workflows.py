"""ワークフロー(04 §15)。定義・実行記録・テスト送信は**管理者だけ**(ワークスペース全体の設定。03 §5)。"""

from typing import Any

from fastapi import APIRouter, Query

from app.api.deps import Admin, Conn
from app.workflows import store, trial

router = APIRouter()


@router.get("/settings/workflows")
def list_workflows(conn: Conn, admin: Admin) -> list[dict[str, Any]]:
    return store.list_all(conn)


@router.post("/settings/workflows")
def create_workflow(body: dict[str, Any], conn: Conn, admin: Admin) -> dict[str, Any]:
    return store.create(conn, body, admin["id"])


@router.post("/settings/workflows/test")
def test_workflow(body: dict[str, Any], conn: Conn, admin: Admin) -> dict[str, Any]:
    """保存前の定義のまま、アクションをその場で 1 回動かす(実行記録には残さない)。"""
    return trial.run(conn, body, admin["id"])


@router.put("/settings/workflows/{workflow_id}")
def update_workflow(workflow_id: str, body: dict[str, Any], conn: Conn, admin: Admin) -> dict[str, Any]:
    return store.update(conn, workflow_id, body)


@router.delete("/settings/workflows/{workflow_id}", status_code=204)
def delete_workflow(workflow_id: str, conn: Conn, admin: Admin) -> None:
    """論理削除。実行記録は残り、`restore` で戻る(画面の「元に戻す」)。"""
    store.delete(conn, workflow_id)


@router.post("/settings/workflows/{workflow_id}/restore")
def restore_workflow(workflow_id: str, conn: Conn, admin: Admin) -> dict[str, Any]:
    return store.restore(conn, workflow_id)


@router.get("/settings/workflows/{workflow_id}/runs")
def list_runs(
    workflow_id: str, conn: Conn, admin: Admin, limit: int = Query(default=50, ge=1, le=200)
) -> list[dict[str, Any]]:
    """実行記録(新しい順)。"""
    return store.runs(conn, workflow_id, limit)


@router.post("/settings/workflows/runs/{run_id}/retry")
def retry_run(run_id: str, conn: Conn, admin: Admin) -> dict[str, Any]:
    """失敗・見送りの実行を、もう一度送る。"""
    return store.retry(conn, run_id)
