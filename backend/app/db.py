"""DB への接続。SQLAlchemy 2 の Core だけを使う(ORM のモデルは書かない。03 §4)。"""

from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from typing import Any

from sqlalchemy import Connection, create_engine
from sqlalchemy.engine import Engine

from app.config import get_settings

_engine: Engine | None = None
_transaction: Callable[[], AbstractContextManager[Connection]] | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        s = get_settings()
        _engine = create_engine(s.sqlalchemy_url, echo=s.echo_sql, pool_pre_ping=True, future=True)
    return _engine


def set_engine(engine: Engine | None) -> None:
    """テストが差し替えるための口。"""
    global _engine
    _engine = engine


def connection() -> Iterator[Connection]:
    """FastAPI の依存。1 リクエスト = 1 トランザクション(例外が出れば巻き戻る)。"""
    with get_engine().begin() as conn:
        yield conn


@contextmanager
def transaction() -> Iterator[Connection]:
    """FastAPI の依存を通らない入口(MCP・OAuth)の 1 まとまり。抜けるときに確定し、例外なら巻き戻る。"""
    if _transaction is not None:
        with _transaction() as conn:
            yield conn
        return
    with get_engine().begin() as conn:
        yield conn


def set_transaction(factory: Callable[[], AbstractContextManager[Connection]] | None) -> None:
    """テストが差し替えるための口(1 テスト = 1 トランザクションの中の SAVEPOINT にする)。"""
    global _transaction
    _transaction = factory


def scalar_one(conn: Connection, stmt: Any) -> Any:
    return conn.execute(stmt).scalar_one()
