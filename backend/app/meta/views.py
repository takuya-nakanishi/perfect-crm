"""ビュー(一覧・カンバン・レポート)の作成と変更(04 §6、05 §10)。正はモックの `schema.ts`。

**誰でも作れて、直せる**(テーブル定義と違って管理者に限らない。03 §5。共有 / 個人ビューは Q-045)。
"""

from typing import Any

from sqlalchemy import Connection, func, select

from app.errors import bad_request, not_found
from app.meta import store
from app.meta.tables import meta_views


def _view_row(conn: Connection, view_id: str) -> Any:
    row = conn.execute(select(meta_views).where(meta_views.c.id == view_id, meta_views.c.deleted_at.is_(None))).first()
    if row is None:
        raise not_found("ビューがありません")
    return row


def check_view_input(obj: dict[str, Any], body: dict[str, Any]) -> None:
    """無い項目を指していたら 400(画面は同じ規則で先に弾く)。"""
    name = str(body.get("name") or "").strip()
    if not name:
        raise bad_request("ビューの名前を入力してください")
    keys = {f["key"] for f in obj["fields"]}
    # 関連先(polymorphic)の 2 列も条件に書ける
    columns = {c for f in obj["fields"] if f.get("columns") for c in (f["columns"]["object"], f["columns"]["id"])}
    config = body.get("config") or {}
    view_type = body.get("type")

    def has(key: Any) -> bool:
        return bool(key) and key in keys

    def check_filter(node: Any) -> None:
        if not node:
            return
        for group in ("and", "or"):
            if group in node:
                for part in node[group]:
                    check_filter(part)
                return
        if not has(node.get("field")) and node.get("field") not in columns:
            raise bad_request(f"条件の項目がありません: {node.get('field')}")

    if view_type == "list":
        if not config.get("columns"):
            raise bad_request("表示する項目を 1 つ以上選んでください")
        for column in config["columns"]:
            if not has(column.get("field")):
                raise bad_request(f"項目がありません: {column.get('field')}")
    elif view_type == "kanban":
        group_by = next((f for f in obj["fields"] if f["key"] == config.get("group_by")), None)
        if group_by is None or group_by["type"] != "select":
            raise bad_request("カンバンで分ける項目には、選択肢の項目を選んでください")
        for key in config.get("card_fields") or []:
            if not has(key):
                raise bad_request(f"項目がありません: {key}")
        if config.get("sum_field") is not None and not has(config["sum_field"]):
            raise bad_request("合計する項目がありません")
    if view_type != "report":
        check_filter(config.get("filter"))
        for sort in config.get("sort") or []:
            if not has(sort.get("field")):
                raise bad_request(f"並び替えの項目がありません: {sort.get('field')}")
    pin = body.get("pin")
    if pin and not str(pin.get("label") or "").strip():
        raise bad_request("お気に入りの名前を入力してください")


def _next_pin_position(conn: Connection) -> int:
    rows = conn.execute(select(meta_views.c.pin).where(meta_views.c.pin.isnot(None)))
    return max([0, *[int((row.pin or {}).get("position") or 0) for row in rows]]) + 1


def create_view(conn: Connection, object_key: str, body: dict[str, Any]) -> str:
    if object_key not in {o["key"] for o in store.all_objects(conn)}:
        raise not_found(f"テーブルがありません: {object_key}")
    obj = store.object_meta(conn, object_key)
    check_view_input(obj, body)
    position = (
        conn.execute(
            select(func.max(meta_views.c.position)).where(
                meta_views.c.object_key == object_key, meta_views.c.deleted_at.is_(None)
            )
        ).scalar()
        or 0
    ) + 1
    pin = body.get("pin")
    if pin:
        pin = {**pin, "position": _next_pin_position(conn)}
    view_id = conn.execute(
        meta_views.insert()
        .values(
            object_key=object_key,
            name=str(body["name"]).strip(),
            type=body["type"],
            position=position,
            config=body.get("config") or {},
            pin=pin,
        )
        .returning(meta_views.c.id)
    ).scalar_one()
    return str(view_id)


def update_view(conn: Connection, view_id: str, body: dict[str, Any]) -> None:
    row = _view_row(conn, view_id)
    obj = store.object_meta(conn, row.object_key)
    check_view_input(obj, body)
    pin = body.get("pin")
    if pin:
        # お気に入りの並びは、既にあればそのまま。新しく付けたら末尾
        current = (row.pin or {}).get("position")
        pin = {**pin, "position": current if current is not None else _next_pin_position(conn)}
    conn.execute(
        meta_views.update()
        .where(meta_views.c.id == view_id)
        .values(
            name=str(body["name"]).strip(),
            type=body["type"],
            config=body.get("config") or {},
            pin=pin,
            updated_at=func.clock_timestamp(),
        )
    )


def delete_view(conn: Connection, view_id: str) -> None:
    row = _view_row(conn, view_id)
    rest = conn.execute(
        select(func.count())
        .select_from(meta_views)
        .where(
            meta_views.c.object_key == row.object_key,
            meta_views.c.id != view_id,
            meta_views.c.deleted_at.is_(None),
        )
    ).scalar_one()
    if rest == 0:
        raise bad_request("最後のビューは削除できません")
    conn.execute(meta_views.update().where(meta_views.c.id == view_id).values(deleted_at=func.clock_timestamp()))


def restore_view(conn: Connection, view_id: str) -> None:
    result = conn.execute(
        meta_views.update()
        .where(meta_views.c.id == view_id, meta_views.c.deleted_at.isnot(None))
        .values(deleted_at=None)
    )
    if result.rowcount == 0:
        raise not_found("削除済みのビューがありません")


def reorder_views(conn: Connection, object_key: str, ids: list[str]) -> None:
    mine = [
        str(row.id)
        for row in conn.execute(
            select(meta_views.c.id).where(meta_views.c.object_key == object_key, meta_views.c.deleted_at.is_(None))
        )
    ]
    if len(ids) != len(mine) or any(view_id not in mine for view_id in ids):
        raise bad_request("並びには、そのテーブルのビューを全部含めてください")
    for position, view_id in enumerate(ids, start=1):
        conn.execute(meta_views.update().where(meta_views.c.id == view_id).values(position=position))
