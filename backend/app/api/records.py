"""レコードの読み取り(04 §2)。一覧が POST なのは、入れ子のフィルタが URL に収まらないため。"""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.deps import Conn, CurrentUser
from app.records import service
from app.records.aggregate import aggregate
from app.records.search import search

router = APIRouter()


class ListParams(BaseModel):
    # フィルタは入れ子になる(条件 / and / or)。中身の検証は SQL に訳すときに行う(04 §3)
    filter: dict[str, Any] | None = None
    sort: list[dict[str, Any]] | None = None
    q: str | None = None
    limit: int | None = Field(default=None, ge=0)
    offset: int | None = Field(default=None, ge=0)


@router.post("/objects/{object_key}/records/query")
def query_records(object_key: str, params: ListParams, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    return service.query(conn, object_key, params.model_dump(exclude_none=True), user["id"])


@router.get("/objects/{object_key}/records/{record_id}")
def read_record(object_key: str, record_id: str, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    return service.find(conn, object_key, record_id)


@router.post("/objects/{object_key}/records", status_code=200)
def create_record(object_key: str, values: dict[str, Any], conn: Conn, user: CurrentUser) -> dict[str, Any]:
    return service.insert(conn, object_key, values, user["id"])


@router.patch("/objects/{object_key}/records/{record_id}")
def patch_record(
    object_key: str, record_id: str, patch: dict[str, Any], conn: Conn, user: CurrentUser
) -> dict[str, Any]:
    return service.update(conn, object_key, record_id, patch, user["id"])


@router.delete("/objects/{object_key}/records/{record_id}", status_code=204)
def delete_record(object_key: str, record_id: str, conn: Conn, user: CurrentUser) -> None:
    service.remove(conn, object_key, record_id)


@router.post("/objects/{object_key}/records/{record_id}/restore")
def restore_record(object_key: str, record_id: str, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    return service.restore(conn, object_key, record_id)


class AggregateParams(BaseModel):
    filter: dict[str, Any] | None = None
    group_by: dict[str, Any] | None = None
    measure: dict[str, Any]
    order: str | None = None
    limit: int | None = Field(default=None, ge=1)


@router.post("/objects/{object_key}/aggregate")
def aggregate_records(object_key: str, params: AggregateParams, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    return aggregate(conn, object_key, params.model_dump(exclude_none=True), user["id"])


@router.get("/search")
def search_all(q: str, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    return search(conn, q)
