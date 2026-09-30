"""テストの土台。**実物の PostgreSQL に対して**回す(L4 相当の検証を含められるようにするため)。

- 1 セッションで 1 回だけ、スキーマを作り直して Alembic と seed を流す
- 1 テスト = 1 トランザクション。終わったら巻き戻すので、テスト同士が干渉しない
- 1 リクエスト = SAVEPOINT。アプリ側のトランザクションの切れ目も本番と同じに保つ

接続先は `WORKS_TEST_DATABASE_URL`(既定は Compose の db。`docker compose --profile backend up -d db`)。
"""

import os
import secrets
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.engine import Engine

from app import db
from app.auth import sessions
from app.main import app
from app.meta import seed as seed_module
from app.meta import store
from app.meta.tables import user_sessions
from app.records.normalize import search_text_of
from app.records.tables import table_of

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
    # ログインは自前(local)。.env に WORKS_AUTH=access があっても、テストはこちら。
    # Access の JWT を確かめるテストは、そのテストの中だけ access に切り替える(test_session.py)
    os.environ["WORKS_AUTH"] = "local"
    # パスワードの決まりで、漏えいした一覧(外のサービス)に問い合わせない。問い合わせの形は差し替えて確かめる
    os.environ["WORKS_PWNED_CHECK"] = "false"
    # ワークフローの送り係(スレッド)は起こさない。テストは `runner.run_due()` を直に呼ぶ
    os.environ["WORKS_WORKFLOW_RUNNER"] = "false"
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
    # FastAPI の依存を通らない入口(MCP・OAuth)も、同じトランザクションの SAVEPOINT にする
    db.set_transaction(contextmanager(override))
    with TestClient(app) as test_client:
        # ブラウザは書き込みに必ず Origin を付ける。Cookie で入った書き込みは、公開 URL と同じものだけが通る(03 §5)
        test_client.headers["origin"] = public_origin()
        yield test_client
    app.dependency_overrides.clear()
    db.set_transaction(None)


def public_origin() -> str:
    from app.api.deps import public_origin as origin

    return origin()


def login_as(
    client: TestClient, user_id: str, *, created_at: datetime | None = None, user_agent: str | None = None
) -> TestClient:
    """その利用者のセッションを直に作り、Cookie を置く(ログインの手順そのものは test_session.py で確かめる)。

    `created_at` を昔にすると、「10 分以内にログインした」に当たらないセッションになる。
    """
    token = secrets.token_urlsafe(32)
    values: dict[str, object] = {
        "user_id": user_id,
        "token_hash": sessions.token_hash(token),
        "method": "password",
        "expires_at": datetime.now(UTC) + sessions.SESSION_TTL,
        "user_agent": user_agent,
    }
    if created_at is not None:
        values["created_at"] = created_at
    with db.transaction() as conn:
        conn.execute(user_sessions.insert().values(**values))
    client.cookies.set(sessions.session_cookie(), token)
    return client


@pytest.fixture
def make(conn: Connection) -> Callable[..., str]:
    """テスト用に 1 行作る。書き込みの API ができるまでの土台(検証も業務ルールも通さない)。"""

    def _make(object_key: str, **values: object) -> str:
        obj = store.object_meta(conn, object_key)
        table = table_of(obj)
        values["search_text"] = search_text_of(obj["fields"], values)
        return str(conn.execute(table.insert().values(**values).returning(table.c.id)).scalar_one())

    return _make


@pytest.fixture
def admin(client: TestClient) -> TestClient:
    """管理者としてログイン済みのクライアント。"""
    return login_as(client, ADMIN_ID)


@pytest.fixture
def member(client: TestClient) -> TestClient:
    """管理者でない利用者としてログイン済みのクライアント。"""
    return login_as(client, MEMBER_ID)
