"""メタデータの読み書き(04 §2・§6)。

テーブルの定義は**管理者だけ**が書ける。ビューは**誰でも**(Notion のように使う人が作る。03 §5)。
"""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import Admin, Conn, CurrentUser
from app.meta import schema, store, views

router = APIRouter()


class KeysBody(BaseModel):
    keys: list[str]


class ViewOrderBody(BaseModel):
    object: str
    ids: list[str]


@router.get("/meta")
def read_meta(conn: Conn, user: CurrentUser) -> dict[str, Any]:
    return store.meta_response(conn)


@router.post("/meta/objects")
def create_object(body: dict[str, Any], conn: Conn, admin: Admin) -> dict[str, Any]:
    schema.create_object(conn, body, user_id=admin["id"])
    return store.meta_response(conn)


# 並びの経路は {key} より先に置く(でないと key="order" として読まれる)
@router.put("/meta/objects/order")
def reorder_objects(body: KeysBody, conn: Conn, admin: Admin) -> dict[str, Any]:
    schema.reorder_objects(conn, body.keys)
    return store.meta_response(conn)


@router.put("/meta/objects/{key}")
def update_object(key: str, body: dict[str, Any], conn: Conn, admin: Admin) -> dict[str, Any]:
    schema.update_object(conn, key, body, user_id=admin["id"])
    return store.meta_response(conn)


@router.delete("/meta/objects/{key}")
def delete_object(key: str, conn: Conn, admin: Admin) -> dict[str, Any]:
    schema.delete_object(conn, key)
    return store.meta_response(conn)


@router.post("/meta/objects/{key}/restore")
def restore_object(key: str, conn: Conn, admin: Admin) -> dict[str, Any]:
    schema.restore_object(conn, key)
    return store.meta_response(conn)


@router.post("/meta/views")
def create_view(body: dict[str, Any], conn: Conn, user: CurrentUser) -> dict[str, Any]:
    views.create_view(conn, str(body.get("object")), body)
    return store.meta_response(conn)


@router.put("/meta/views/order")
def reorder_views(body: ViewOrderBody, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    views.reorder_views(conn, body.object, body.ids)
    return store.meta_response(conn)


@router.put("/meta/views/{view_id}")
def update_view(view_id: str, body: dict[str, Any], conn: Conn, user: CurrentUser) -> dict[str, Any]:
    views.update_view(conn, view_id, body)
    return store.meta_response(conn)


@router.delete("/meta/views/{view_id}")
def delete_view(view_id: str, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    views.delete_view(conn, view_id)
    return store.meta_response(conn)


@router.post("/meta/views/{view_id}/restore")
def restore_view(view_id: str, conn: Conn, user: CurrentUser) -> dict[str, Any]:
    views.restore_view(conn, view_id)
    return store.meta_response(conn)
