"""`meta_*` を読んで、画面が受け取る形(`MetaResponse`)に組み立てる。

振る舞いの正はモックの `frontend/src/mocks/schema.ts`(`liveObjects` / `cleanView` / `visibleMeta`)。
決まりは 02 §5 — **保存してある形は壊さず、返すときに「もう無いもの」を指す定義だけ外す**。
"""

from typing import Any

from sqlalchemy import Connection, select

from app.errors import not_found
from app.meta.tables import meta_fields, meta_objects, meta_views, users, workspace

# 値が真のときだけ応答に入れる属性(モックの fixtures と同じ形にする)
TRUE_ONLY = ("required", "readonly", "locked", "all_targets")
# NULL でなければ入れる属性
OPTIONAL = (
    "options",
    "target",
    "targets",
    "columns",
    "semantic",
    "in_create_form",
    "placeholder",
    "max_length",
    "scale",
)


def _field_dict(row: Any) -> dict[str, Any]:
    field: dict[str, Any] = {"key": row.key, "label": row.label, "type": row.type}
    for name in TRUE_ONLY:
        if getattr(row, name):
            field[name] = True
    for name in OPTIONAL:
        value = row._mapping[name]
        if value is not None:
            field[name] = value
    return field


def _object_dict(row: Any, fields: list[dict[str, Any]]) -> dict[str, Any]:
    obj: dict[str, Any] = {
        "key": row.key,
        "label": row.label,
        "icon": row.icon,
        "color": row.color,
        "name_field": row.name_field,
        "position": row.position,
        "in_sidebar": row.in_sidebar,
    }
    if row.subtitle_field is not None:
        obj["subtitle_field"] = row.subtitle_field
    if row.system:
        obj["system"] = True
    if row.completion is not None:
        obj["completion"] = row.completion
    if row.timeline is not None:
        obj["timeline"] = row.timeline
    obj["fields"] = fields
    return obj


def all_objects(conn: Connection, *, include_deleted: bool = False) -> list[dict[str, Any]]:
    """テーブルの定義。`include_deleted` なら論理削除したものも(残っているレコードの表示名を解くのに要る)。"""
    stmt = select(meta_objects).order_by(meta_objects.c.position, meta_objects.c.key)
    if not include_deleted:
        stmt = stmt.where(meta_objects.c.deleted_at.is_(None))
    objects = []
    for row in conn.execute(stmt):
        fields = [
            _field_dict(f)
            for f in conn.execute(
                select(meta_fields)
                .where(meta_fields.c.object_key == row.key, meta_fields.c.hidden.is_(False))
                .order_by(meta_fields.c.position)
            )
        ]
        objects.append(_object_dict(row, fields))
    return objects


def object_meta(conn: Connection, key: str) -> dict[str, Any]:
    """1 つのテーブルの定義(論理削除中でも引ける)。無ければ 404。"""
    for obj in all_objects(conn, include_deleted=True):
        if obj["key"] == key:
            return obj
    raise not_found(f"テーブルがありません: {key}")


def live_objects(conn: Connection) -> list[dict[str, Any]]:
    """いま使えるテーブル。**消えたテーブルを指す参照の項目は外して返す**(モックの `liveObjects`)。"""
    objects = all_objects(conn)
    alive = {o["key"] for o in objects}
    for obj in objects:
        fields = []
        for field in obj["fields"]:
            if field["type"] == "relation" and field.get("target") not in alive:
                continue
            if field["type"] == "polymorphic" and field.get("targets") is not None:
                field = {**field, "targets": [t for t in field["targets"] if t in alive]}
            fields.append(field)
        obj["fields"] = fields
    return objects


def view_field_keys(obj: dict[str, Any]) -> list[str]:
    """ビューの定義が指してよい名前。

    polymorphic は、論理名(`related`)と実際の 2 列(`related_object`・`related_id`)のどちらでも指せる。
    ビューの列は論理名で、レポートの分け方は `related_object` で指す(META-096)。
    """
    out: list[str] = []
    for field in obj["fields"]:
        cols = field.get("columns")
        out += [field["key"], cols["object"], cols["id"]] if cols else [field["key"]]
    return out


def clean_filter(filter_: Any, has: Any) -> Any:
    """無い項目を指す条件を外す。**外すと条件が緩んで表示が広がる**(02 §5 の決まり)。群が空になれば群ごと外す。"""
    if not filter_:
        return None
    for key in ("and", "or"):
        if key in filter_:
            parts = [p for p in (clean_filter(p, has) for p in filter_[key]) if p]
            return {key: parts} if parts else None
    return filter_ if has(filter_.get("field")) else None


def clean_view(view: dict[str, Any], obj: dict[str, Any]) -> dict[str, Any] | None:
    """無くなった項目を指す部分を外したビュー。成り立たなくなったもの(分ける列の無いカンバン)は None。"""
    columns = view_field_keys(obj)

    def has(key: Any) -> bool:
        return bool(key) and key in columns

    config = dict(view["config"])
    if view["type"] == "list":
        config["columns"] = [c for c in config.get("columns", []) if has(c.get("field"))]
        if config.get("sort") is not None:
            config["sort"] = [s for s in config["sort"] if has(s.get("field"))]
        config["filter"] = clean_filter(config.get("filter"), has)
    elif view["type"] == "kanban":
        if not has(config.get("group_by")):
            return None
        config["card_fields"] = [f for f in config.get("card_fields", []) if has(f)]
        if not has(config.get("sum_field")):
            config.pop("sum_field", None)
        if config.get("sort") is not None:
            config["sort"] = [s for s in config["sort"] if has(s.get("field"))]
        config["filter"] = clean_filter(config.get("filter"), has)
    else:
        widgets = []
        for widget in config.get("widgets", []):
            used = [widget["measure"].get("field"), widget["measure"].get("weight_field")]
            if widget["type"] != "stat":
                used.append(widget["group_by"].get("field"))
            if all(has(k) for k in used if k):
                widgets.append(widget)
        if not widgets:
            return None
        config = {"widgets": widgets}
    if config.get("filter") is None:
        config.pop("filter", None)
    return {**view, "config": config}


def _view_dict(row: Any) -> dict[str, Any]:
    view: dict[str, Any] = {
        "id": str(row.id),
        "object": row.object_key,
        "type": row.type,
        "name": row.name,
        "position": row.position,
        "config": row.config,
    }
    if row.pin is not None:
        view["pin"] = row.pin
    return view


def all_views(conn: Connection) -> list[dict[str, Any]]:
    stmt = (
        select(meta_views)
        .where(meta_views.c.deleted_at.is_(None))
        .order_by(meta_views.c.object_key, meta_views.c.position)
    )
    return [_view_dict(row) for row in conn.execute(stmt)]


def all_users(conn: Connection) -> list[dict[str, Any]]:
    stmt = select(users).where(users.c.deleted_at.is_(None)).order_by(users.c.created_at)
    out = []
    for row in conn.execute(stmt):
        user: dict[str, Any] = {
            "id": str(row.id),
            "name": row.name,
            "email": row.email,
            "avatar_color": row.avatar_color,
        }
        if row.admin:
            user["admin"] = True
        out.append(user)
    return out


def get_workspace(conn: Connection) -> dict[str, Any]:
    row = conn.execute(select(workspace).order_by(workspace.c.created_at).limit(1)).first()
    if row is None:
        raise not_found("ワークスペースがまだありません(seed を流してください)")
    return {"id": str(row.id), "name": row.name, "timezone": row.timezone}


def meta_response(conn: Connection) -> dict[str, Any]:
    """GET /meta の応答(モックの `visibleMeta`)。"""
    objects = live_objects(conn)
    by_key = {o["key"]: o for o in objects}
    views = []
    for view in all_views(conn):
        obj = by_key.get(view["object"])
        cleaned = clean_view(view, obj) if obj else None
        if cleaned:
            views.append(cleaned)
    return {
        "workspace": get_workspace(conn),
        "objects": objects,
        "views": views,
        "users": all_users(conn),
    }
