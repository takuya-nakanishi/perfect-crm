"""テストの土台。**実物の PostgreSQL に対して**回す(L4 相当の検証を含められるようにするため)。

- 1 セッションで 1 回だけ、スキーマを作り直して Alembic と seed を流す
- 1 テスト = 1 トランザクション。終わったら巻き戻すので、テスト同士が干渉しない
- 1 リクエスト = SAVEPOINT。アプリ側のトランザクションの切れ目も本番と同じに保つ

接続先は `WORKS_TEST_DATABASE_URL`(既定は Compose の db。`docker compose --profile backend up -d db`)。
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.engine import Engine

from app import db
from app.main import app
from app.meta import seed as seed_module

BACKEND_DIR = Path(__file__).resolve().parent.parent
# Compose の db が公開しているポート(docker-compose.yml。127.0.0.1 からだけ届く)
TEST_PORT = os.environ.get("WORKS_TEST_DB_PORT", "55432")


def _default_url() -> str:
    """.env の利用者とパスワードを使い、**DB 名だけ `_test` に替えた**接続先。"""
    from app.config import Settings

    s = Settings()
    return f"postgresql+psycopg://{s.db_user}:{s.db_password}@127.0.0.1:{TEST_PORT}/{s.db_name}_test"


TEST_URL = os.environ.get("WORKS_TEST_DATABASE_URL") or _default_url()

# **安全装置**: このテストはスキーマを作り直す(drop schema public cascade)。
# 本番の DB に向いていたら全部消える。名前が `_test` で終わる DB にしか繋がない
if not TEST_URL.rsplit("/", 1)[-1].split("?")[0].endswith("_test"):
    raise SystemExit(
        f"テストの接続先は名前が _test で終わる DB だけです(いま: {TEST_URL.rsplit('/', 1)[-1]})。"
        "WORKS_TEST_DATABASE_URL を確かめてください"
    )


def _ensure_database() -> None:
    """テスト用の DB が無ければ作る(`docker compose --profile backend up -d db` のあと 1 回)。"""
    import psycopg

    url, _, name = TEST_URL.rpartition("/")
    admin_url = f"{url}/postgres".replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(admin_url, autocommit=True) as conn:
        exists = conn.execute("select 1 from pg_database where datname = %s", (name,)).fetchone()
        if not exists:
            conn.execute(f'create database "{name}"')


# 開発用の管理者(モックの fixtures と同じ ID にして、画面の E2E から見た形を揃える)
ADMIN_ID = "09000000-0000-7000-8000-000000000001"
ADMIN_EMAIL = "takuya@example.jp"
MEMBER_ID = "09000000-0000-7000-8000-000000000002"
MEMBER_EMAIL = "misaki@example.jp"


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    os.environ["WORKS_DATABASE_URL"] = TEST_URL
    # TestClient は http://testserver を名乗るので、Secure 付きの Cookie は保存されない(本番は https)
    os.environ["WORKS_SECURE_COOKIE"] = "false"
    from app.config import get_settings

    get_settings.cache_clear()
    _ensure_database()
    engine = create_engine(TEST_URL, future=True)
    with engine.begin() as conn:
        # 前のテストの残骸を消してから作り直す(テストの DB だけ。本番の経路では使わない)
        conn.execute(text("drop schema public cascade"))
        conn.execute(text("create schema public"))
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    command.upgrade(config, "head")
    with engine.begin() as conn:
        seed_module.seed(conn)
        seed_module.ensure_user(conn, name="Takuya", email=ADMIN_EMAIL, admin=True, id=ADMIN_ID)
        seed_module.ensure_user(conn, name="Misaki", email=MEMBER_EMAIL, id=MEMBER_ID)
    db.set_engine(engine)
    yield engine
    db.set_engine(None)
    engine.dispose()


@pytest.fixture
def conn(engine: Engine) -> Iterator[Connection]:
    connection = engine.connect()
    trans = connection.begin()
    try:
        yield connection
    finally:
        trans.rollback()
        connection.close()


@pytest.fixture
def client(conn: Connection) -> Iterator[TestClient]:
    def override() -> Iterator[Connection]:
        nested = conn.begin_nested()
        try:
            yield conn
        except Exception:
            nested.rollback()
            raise
        else:
            nested.commit()

    app.dependency_overrides[db.connection] = override
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def admin(client: TestClient) -> TestClient:
    """管理者としてログイン済みのクライアント。"""
    response = client.post("/api/v1/session", json={"email": ADMIN_EMAIL, "password": "x"})
    assert response.status_code == 200, response.text
    return client


@pytest.fixture
def member(client: TestClient) -> TestClient:
    """管理者でない利用者としてログイン済みのクライアント。"""
    response = client.post("/api/v1/session", json={"email": MEMBER_EMAIL, "password": "x"})
    assert response.status_code == 200, response.text
    return client
