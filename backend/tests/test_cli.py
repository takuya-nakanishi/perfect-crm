"""管理者のコマンド(04 §16)。`get_engine` をテストのトランザクションに差し替え、本物の DB の行で確かめる。"""

import io
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Connection, func, select, update

from app import cli
from app.auth import passwords
from app.meta.tables import oauth_clients, oauth_grants, user_sessions, users
from tests.conftest import ADMIN_EMAIL, ADMIN_ID, login_as

PASSWORD = "correct horse battery staple"


class _Engine:
    """CLI の `get_engine().begin()` を、テストのトランザクションの中の SAVEPOINT にする。"""

    def __init__(self, conn: Connection) -> None:
        self.conn = conn

    @contextmanager
    def begin(self) -> Iterator[Connection]:
        with self.conn.begin_nested():
            yield self.conn


@pytest.fixture
def run(conn: Connection, monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(cli, "get_engine", lambda: _Engine(conn))

    def _run(password: str = PASSWORD) -> int:
        # 端末でなければ 1 行目を読む(パイプで渡す形)
        monkeypatch.setattr("sys.stdin", io.StringIO(password + "\n"))
        return cli.set_password([ADMIN_EMAIL])

    return _run


def _connected(client: TestClient, conn: Connection) -> None:
    """ブラウザのセッションと、Claude のコネクタの許可がある状態にする。"""
    login_as(client, ADMIN_ID)
    conn.execute(oauth_clients.insert().values(client_id="claude", info={}))
    conn.execute(oauth_grants.insert().values(client_id="claude", user_id=ADMIN_ID, scopes=["works"]))


def _left(conn: Connection) -> tuple[int, int]:
    count = func.count()
    return (
        conn.execute(select(count).select_from(user_sessions).where(user_sessions.c.user_id == ADMIN_ID)).scalar_one(),
        conn.execute(select(count).select_from(oauth_grants).where(oauth_grants.c.user_id == ADMIN_ID)).scalar_one(),
    )


def test_初めてのパスワードでは_ログイン中の端末とアプリの許可を残す(
    client: TestClient, conn: Connection, run: Any, capsys: pytest.CaptureFixture[str]
) -> None:
    _connected(client, conn)
    assert run() == 0
    assert "許可は残しました" in capsys.readouterr().out
    stored = conn.execute(select(users.c.password_hash).where(users.c.id == ADMIN_ID)).scalar_one()
    assert passwords.verify(stored, PASSWORD)
    # Claude のコネクタもブラウザも切れていない
    assert _left(conn) == (1, 1)
    assert client.get("/api/v1/session").status_code == 200


def test_決め直すと_ログイン中の端末とアプリの許可をすべて切る(
    client: TestClient, conn: Connection, run: Any, capsys: pytest.CaptureFixture[str]
) -> None:
    conn.execute(
        update(users).where(users.c.id == ADMIN_ID).values(password_hash=passwords.hash_password("old password here!"))
    )
    _connected(client, conn)
    assert run() == 0
    assert capsys.readouterr().out.strip() == "ok"
    assert _left(conn) == (0, 0)
    assert client.get("/api/v1/session").status_code == 401


def test_決まりに合わないパスワードは決めない(conn: Connection, run: Any, capsys: pytest.CaptureFixture[str]) -> None:
    assert run("short") == 1
    assert "15 文字以上" in capsys.readouterr().err
    assert conn.execute(select(users.c.password_hash).where(users.c.id == ADMIN_ID)).scalar_one() is None
