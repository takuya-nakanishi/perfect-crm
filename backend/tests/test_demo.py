"""E2E の種のデータ(app/demo.py。J-024)。モックの fixtures と同じ中身が、今日基準の日付で入る。"""

import json
from datetime import date
from typing import Any

import pytest
from sqlalchemy import Connection, create_engine, func, select

from app import demo
from app.meta import store
from app.meta.tables import activity_mentions
from app.records.rules import today_in
from app.records.tables import table_of


def _fixture(name: str) -> Any:
    return json.loads((demo.FIXTURES_DIR / f"{name}.json").read_text(encoding="utf-8"))


def test_fixtures_の行がそのまま入り_日付は今日基準にずれる(conn: Connection) -> None:
    demo.load(conn)
    for key in demo.ORDER:
        table = table_of(store.object_meta(conn, key))
        assert conn.execute(select(func.count()).select_from(table)).scalar_one() == len(_fixture(key)), key

    base = date.fromisoformat(_fixture("workspace")["base_date"])
    days = (date.fromisoformat(today_in("Asia/Tokyo")) - base).days
    first = _fixture("tasks")[0]
    tasks = table_of(store.object_meta(conn, "tasks"))
    due = conn.execute(select(tasks.c.due_date).where(tasks.c.id == first["id"])).scalar_one()
    assert (due - date.fromisoformat(first["due_date"])).days == days


def test_活動の言及は結合表にも入る(conn: Connection) -> None:
    demo.load(conn)
    expected = sum(1 for a in _fixture("activities") if 'data-type="mention"' in (a.get("body") or ""))
    assert expected > 0
    assert conn.execute(select(func.count()).select_from(activity_mentions)).scalar_one() >= expected


def test_名前が__e2e_で終わらない_DB_は作り直さない() -> None:
    engine = create_engine("postgresql+psycopg://works:x@127.0.0.1:1/works")
    with pytest.raises(SystemExit):
        demo.reset(engine)
