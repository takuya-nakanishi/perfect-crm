"""メタデータの読み書き(04 §2・§6)。

テーブルの定義は**管理者だけ**が書ける。ビューは**誰でも**(Notion のように使う人が作る。03 §5)。
"""

from typing import Annotated, Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.deps import Admin, Conn, CurrentUser
from app.meta import schema, store, views

router = APIRouter()


class SidebarObject(BaseModel):
    type: Literal["object"]
    key: str


class SidebarFolder(BaseModel):
    type: Literal["folder"]
    # UUID かどうかは schema.save_sidebar が確かめる(日本語の文で断るため)
    id: str
    label: str
    keys: list[str]


class SidebarBody(BaseModel):
    """サイドバーの並びとフォルダ。上から順に全量で(04 §2、型は frontend の `SidebarItem`)。"""

    items: list[Annotated[SidebarObject | SidebarFolder, Field(discriminator="type")]]


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


# サイドバーはワークスペース共通なので、並びとフォルダも管理者だけ(利用者ごとに持つかは Q-045)
@router.put("/meta/sidebar")
def save_sidebar(body: SidebarBody, conn: Conn, admin: Admin) -> dict[str, Any]:
    schema.save_sidebar(conn, [item.model_dump() for item in body.items])
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
