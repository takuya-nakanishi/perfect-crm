"""削除するレコードを指している参照の扱い(02 §4)。

- **必須の参照項目が、生きている行からこのレコードを指していれば、削除させない**(409 `referenced`)。
  空にすると、その行が必須に反したまま残るため。先に付け替えるか、その行を消す
- それ以外(任意の参照、削除中の行、外した項目の列、削除中のテーブルの行)は、指している側の列を空にし、
  `detached_refs` に控えて、`restore` で付け直す。その間に別の値が入った列は上書きしない。
  残すと、画面・絞り込み・並び・集計・CSV・MCP のどこでも消したはずの相手が見え続ける
  (読むところ全部で隠すより、書くところ 1 か所で外すほうが漏れない)
- 必須の参照が空になった行(削除中に相手を消されたもの)は、相手を先に戻すまで戻させない(409 `reference_deleted`)

指している側の `updated_at` は動かさない(利用者が変えたのではなく、「元に戻す」で元どおりになる副作用なので)。
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import Connection, Text, delete, func, select, update
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID, insert
from sqlalchemy.sql import TableClause, column, table
from sqlalchemy.sql.expression import ColumnClause

from app.meta import store
from app.meta.tables import detached_refs, meta_fields, meta_objects
from app.records.refs import ref_of


@dataclass(frozen=True)
class RefColumn:
    """参照を持ちうる列。"""

    object_key: str  # 指している側のテーブル
    column: str  # 相手の ID が入る列
    object_column: str | None  # polymorphic の「どのテーブルか」の列(relation は None)
    target: str | None  # relation の相手のテーブル(polymorphic は None。どのテーブルでも指せる)
    required: bool = False
    # 画面から触れる列か(外した項目でも、削除中のテーブルの列でもない)。必須の決まりが効くのはこの列だけ
    live: bool = True
    label: str = ""  # 項目名
    object_label: str = ""  # 指している側のテーブル名
    name_field: str | None = None  # 指している側の表示名の列

    def points_to(self, object_key: str) -> bool:
        return self.target is None or self.target == object_key

    def rows(self) -> TableClause:
        """この列を読み書きするための最小の表。外した項目の列も扱うので、`table_of`(見えている項目だけ)は使わない。"""
        cols: list[ColumnClause[Any]] = [
            column("id", UUID(as_uuid=False)),
            column("deleted_at", TIMESTAMP(timezone=True)),
            column(self.column, UUID(as_uuid=False)),
        ]
        if self.object_column:
            cols.append(column(self.object_column, Text))
        if self.name_field:
            cols.append(column(self.name_field, Text))
        return table(self.object_key, *cols)


def reference_columns(conn: Connection) -> list[RefColumn]:
    """参照を持ちうる全部の列(外した項目も、削除中のテーブルのものも)。"""
    stmt = (
        select(
            meta_fields,
            meta_objects.c.label.label("object_label"),
            meta_objects.c.name_field,
            meta_objects.c.deleted_at,
        )
        .join(meta_objects, meta_objects.c.key == meta_fields.c.object_key)
        .where(meta_fields.c.type.in_(("relation", "polymorphic")))
        .order_by(meta_fields.c.object_key, meta_fields.c.position)
    )
    out: list[RefColumn] = []
    for row in conn.execute(stmt):
        m = row._mapping
        # (相手の ID の列, どのテーブルかの列, 相手のテーブル)
        if m["type"] == "relation" and m["target"]:
            shape: tuple[str, str | None, str | None] = (m["key"], None, m["target"])
        elif m["type"] == "polymorphic" and m["columns"]:
            shape = (m["columns"]["id"], m["columns"]["object"], None)
        else:
            continue
        out.append(
            RefColumn(
                m["object_key"],
                *shape,
                required=bool(m["required"]),
                live=not m["hidden"] and m["deleted_at"] is None,
                label=m["label"],
                object_label=m["object_label"],
                name_field=m["name_field"],
            )
        )
    return out


@dataclass(frozen=True)
class Holder:
    """必須の参照でレコードを指している、生きている行の群(テーブルと項目ごと)。"""

    ref: RefColumn
    count: int
    first_name: str


def holders(conn: Connection, object_key: str, record_id: str) -> list[Holder]:
    """このレコードを必須の参照で指している、生きている行。1 件でもあれば削除させない。"""
    out: list[Holder] = []
    for ref in reference_columns(conn):
        if not (ref.required and ref.live and ref.points_to(object_key)):
            continue
        rows = ref.rows()
        # 自分自身を指す行(自己参照)は、一緒に消えるので数えない
        where = [rows.c[ref.column] == record_id, rows.c.deleted_at.is_(None), rows.c.id != record_id]
        if ref.object_column:
            where.append(rows.c[ref.object_column] == object_key)
        count = conn.execute(select(func.count()).select_from(rows).where(*where)).scalar_one()
        if count:
            # 知らせに出す 1 件は、表示名の文字コード順で最初のもの(モックと同じ順。DB の照合順序に左右されない)
            name = func.coalesce(rows.c[ref.name_field] if ref.name_field else None, "")
            first = conn.execute(
                select(name).where(*where).order_by(name.collate("C"), rows.c.id).limit(1)
            ).scalar_one()
            out.append(Holder(ref, count, str(first)))
    return out


def in_use_message(found: list[Holder]) -> str:
    parts = [
        f"{h.ref.object_label}「{h.first_name or '名称未設定'}」"
        f"{f'ほか {h.count - 1} 件' if h.count > 1 else ''}の「{h.ref.label}」(必須)"
        for h in found
    ]
    return f"削除できません。{'、'.join(parts)}に指定されています"


def missing_on_restore(conn: Connection, object_key: str, record_id: str) -> list[tuple[RefColumn, str, str]]:
    """戻すと必須の参照が空のまま生き返るもの(削除中に相手を消された)。相手のテーブルと ID を添える。

    控えは相手を戻したときに消えるので、控えが残っていれば相手はまだ削除中。
    """
    required = {(r.object_key, r.column): r for r in reference_columns(conn) if r.required and r.live}
    mine = [detached_refs.c.ref_object_key == object_key, detached_refs.c.ref_record_id == record_id]
    out: list[tuple[RefColumn, str, str]] = []
    for entry in conn.execute(select(detached_refs).where(*mine)):
        ref = required.get((entry.ref_object_key, entry.ref_column))
        if ref:
            out.append((ref, entry.object_key, str(entry.record_id)))
    return out


def restore_message(conn: Connection, missing: list[tuple[RefColumn, str, str]]) -> str:
    parts = []
    for ref, target_key, target_id in missing:
        name = ref_of(conn, target_key, [target_id]).get(target_id, {}).get("name") or "名称未設定"
        parts.append(f"「{ref.label}」(必須)の{store.object_meta(conn, target_key)['label']}「{name}」")
    return f"元に戻せません。{'、'.join(parts)}が削除されています。先にそちらを元に戻してください"


def detach(conn: Connection, object_key: str, record_id: str) -> None:
    """`object_key` の `record_id` を指している参照を全部外し、控えに残す(削除の続き)。"""
    kept: list[dict[str, Any]] = []
    for ref in reference_columns(conn):
        if not ref.points_to(object_key):
            continue
        rows = ref.rows()
        values: dict[str, Any] = {ref.column: None}
        where = [rows.c[ref.column] == record_id]
        if ref.object_column:
            values[ref.object_column] = None
            where.append(rows.c[ref.object_column] == object_key)
        for ref_id in conn.execute(update(rows).where(*where).values(values).returning(rows.c.id)).scalars():
            kept.append(_entry(object_key, record_id, ref, ref_id))
    _keep(conn, kept)


def reattach(conn: Connection, object_key: str, record_id: str) -> None:
    """控えにある参照を付け直す(元に戻したとき)。**空のままの列だけ**で、その間に入れた別の値は上書きしない。"""
    mine = [detached_refs.c.object_key == object_key, detached_refs.c.record_id == record_id]
    for entry in conn.execute(select(detached_refs).where(*mine)):
        ref = RefColumn(entry.ref_object_key, entry.ref_column, entry.ref_object_column, None)
        rows = ref.rows()
        values: dict[str, Any] = {ref.column: record_id}
        where = [rows.c.id == str(entry.ref_record_id), rows.c[ref.column].is_(None)]
        if ref.object_column:
            values[ref.object_column] = object_key
            where.append(rows.c[ref.object_column].is_(None))
        conn.execute(update(rows).where(*where).values(values))
    conn.execute(delete(detached_refs).where(*mine))


def detach_dangling(conn: Connection) -> int:
    """論理削除中のレコードを指したまま残っている参照を外し、控えに残す。外した数を返す。

    この決まり(2026-09-26)より前に消したものの後始末。起動のたびに流す(`app.cli init`。冪等)。
    """
    keys = set(conn.execute(select(meta_objects.c.key)).scalars())
    kept: list[dict[str, Any]] = []
    for ref in reference_columns(conn):
        for target in [ref.target] if ref.target else sorted(keys):
            if target not in keys:
                continue
            rows = ref.rows()
            gone = table(
                target, column("id", UUID(as_uuid=False)), column("deleted_at", TIMESTAMP(timezone=True))
            ).alias("gone")
            values: dict[str, Any] = {ref.column: None}
            where = [gone.c.id == rows.c[ref.column], gone.c.deleted_at.isnot(None)]
            if ref.object_column:
                values[ref.object_column] = None
                where.append(rows.c[ref.object_column] == target)
            stmt = update(rows).where(*where).values(values).returning(rows.c.id, gone.c.id.label("target_id"))
            for ref_id, target_id in conn.execute(stmt):
                kept.append(_entry(target, target_id, ref, ref_id))
    _keep(conn, kept)
    return len(kept)


def _entry(object_key: str, record_id: str, ref: RefColumn, ref_id: str) -> dict[str, Any]:
    return {
        "object_key": object_key,
        "record_id": record_id,
        "ref_object_key": ref.object_key,
        "ref_record_id": ref_id,
        "ref_column": ref.column,
        "ref_object_column": ref.object_column,
    }


def _keep(conn: Connection, entries: list[dict[str, Any]]) -> None:
    if entries:
        # 同じ控えが既にあれば、それで足りる(中身は同じ)
        conn.execute(insert(detached_refs).on_conflict_do_nothing(), entries)
