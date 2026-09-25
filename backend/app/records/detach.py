"""削除したレコードを指す参照を外し、元に戻したら付け直す(02 §4)。

削除は論理削除だが、**指している側の列は空にする**。残すと、画面・絞り込み・並び・集計・CSV・MCP のどこでも
消したはずの相手が見え続ける(読むところ全部で隠すより、書くところ 1 か所で外すほうが漏れない)。
外した参照は `detached_refs` に控え、`restore` で付け直す。その間に別の値が入った列は上書きしない。

対象は参照を持ちうる全部の列 — 外した項目(`hidden`)の列、削除中のテーブルの行、削除中の行も含める。
どれも「戻す」操作で表に出てくるので、そのときに消えた相手を指していないように。
指している側の `updated_at` は動かさない(利用者が変えたのではなく、「元に戻す」で元どおりになる副作用なので)。
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import Connection, Text, delete, select, update
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID, insert
from sqlalchemy.sql import TableClause, column, table

from app.meta.tables import detached_refs, meta_fields, meta_objects


@dataclass(frozen=True)
class RefColumn:
    """参照を持ちうる列。"""

    object_key: str  # 指している側のテーブル
    column: str  # 相手の ID が入る列
    object_column: str | None  # polymorphic の「どのテーブルか」の列(relation は None)
    target: str | None  # relation の相手のテーブル(polymorphic は None。どのテーブルでも指せる)

    def rows(self) -> TableClause:
        """この列を読み書きするための最小の表。外した項目の列も扱うので、`table_of`(見えている項目だけ)は使わない。"""
        cols = [column("id", UUID(as_uuid=False)), column(self.column, UUID(as_uuid=False))]
        if self.object_column:
            cols.append(column(self.object_column, Text))
        return table(self.object_key, *cols)


def reference_columns(conn: Connection) -> list[RefColumn]:
    """参照を持ちうる全部の列(外した項目も、削除中のテーブルのものも)。"""
    out: list[RefColumn] = []
    stmt = select(meta_fields).where(meta_fields.c.type.in_(("relation", "polymorphic")))
    for row in conn.execute(stmt.order_by(meta_fields.c.object_key, meta_fields.c.key)):
        cols = row._mapping["columns"]
        if row.type == "relation" and row.target:
            out.append(RefColumn(row.object_key, row.key, None, row.target))
        elif row.type == "polymorphic" and cols:
            out.append(RefColumn(row.object_key, cols["id"], cols["object"], None))
    return out


def detach(conn: Connection, object_key: str, record_id: str) -> None:
    """`object_key` の `record_id` を指している参照を全部外し、控えに残す(削除の続き)。"""
    kept: list[dict[str, Any]] = []
    for ref in reference_columns(conn):
        if ref.target is not None and ref.target != object_key:
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
