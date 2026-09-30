"""画面のモックと同じ種のデータ(`frontend/src/mocks/fixtures/`)を DB に入れる。E2E を http で回すため(J-024)。

モックと同じく、日付は「今日」基準へずらす(`base_date` → 今日)。いつ走らせても、今日のタスクや今月の商談がある。
**E2E 専用の DB(名前が `_e2e` で終わる)にしか入れない。**スキーマを消して作り直すので、本番の `works` に向けない。
"""

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, Engine, func, text, update

from app.auth import passwords, totp
from app.meta import seed, store
from app.meta.tables import activity_mentions, users, workspace
from app.records.normalize import search_text_of
from app.records.richtext import mentions_value
from app.records.rules import today_in
from app.records.tables import fields_by_column, table_of
from app.records.values import to_db

BACKEND_DIR = Path(__file__).resolve().parent.parent
FIXTURES_DIR = BACKEND_DIR.parent / "frontend" / "src" / "mocks" / "fixtures"
# 参照の向き(取引先 ← 取引先責任者 ← 商談 ← タスク・活動)に合わせて入れる
ORDER = ("accounts", "contacts", "opportunities", "tasks", "activities")
SUFFIX = "_e2e"

# E2E(http)がログインに使う値(03 §5)。E2E 専用の DB にしか入らない。frontend/e2e/smoke.mjs と揃える。
# 管理者は 2 段階認証を設定済みにし(E2E がこの秘密から 6 桁を計算する)、もう 1 人は初めてのログインで設定の段を通る
E2E_PASSWORD = "works-e2e-password"
E2E_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"


def _load(fixtures: Path, name: str) -> Any:
    return json.loads((fixtures / f"{name}.json").read_text(encoding="utf-8"))


def _shift(value: Any, ftype: str, days: int) -> Any:
    if not isinstance(value, str) or days == 0:
        return value
    if ftype == "date":
        return (date.fromisoformat(value) + timedelta(days=days)).isoformat()
    moved = datetime.fromisoformat(value.replace("Z", "+00:00")) + timedelta(days=days)
    return moved.isoformat()


def load(conn: Connection, fixtures: Path = FIXTURES_DIR) -> None:
    """種の利用者・ワークスペース名・レコードを入れる。メタデータは `seed.seed` が入れたものを使う。"""
    meta = _load(fixtures, "workspace")
    conn.execute(update(workspace).values(name=meta["workspace"]["name"]))
    hashed = passwords.hash_password(E2E_PASSWORD)
    for user in _load(fixtures, "users"):
        seed.ensure_user(
            conn,
            name=user["name"],
            email=user["email"],
            admin=bool(user.get("admin")),
            id=user["id"],
            avatar_color=user.get("avatar_color"),
        )
        values: dict[str, Any] = {"password_hash": hashed, "password_changed_at": func.clock_timestamp()}
        if user.get("admin"):
            values.update(totp_secret=totp.encrypt(E2E_TOTP_SECRET), totp_enabled_at=func.clock_timestamp())
        conn.execute(update(users).where(users.c.id == user["id"]).values(**values))

    timezone = store.get_workspace(conn)["timezone"]
    days = (date.fromisoformat(today_in(timezone)) - date.fromisoformat(meta["base_date"])).days
    for object_key in ORDER:
        obj = store.object_meta(conn, object_key)
        table = table_of(obj)
        fields = fields_by_column(obj)
        for fixture in _load(fixtures, object_key):
            row = dict(fixture)
            for column, field in fields.items():
                if field["type"] in ("date", "datetime") and column in row:
                    row[column] = _shift(row[column], field["type"], days)
            payload = {k: to_db(v, fields.get(k)) for k, v in row.items() if k in table.c}
            payload["search_text"] = search_text_of(obj["fields"], row)
            conn.execute(table.insert().values(**payload))
            timeline = obj.get("timeline")
            if timeline:
                for ref in json.loads(mentions_value(row.get(timeline["body"])) or "[]"):
                    target_object, _, target_id = ref.partition(":")
                    conn.execute(
                        activity_mentions.insert().values(
                            activity_id=row["id"], object_key=target_object, record_id=target_id
                        )
                    )


def _ensure_database(engine: Engine) -> None:
    """E2E 用の DB が無ければ作る。"""
    import psycopg

    name = engine.url.database
    admin_url = engine.url.set(database="postgres", drivername="postgresql").render_as_string(hide_password=False)
    with psycopg.connect(admin_url, autocommit=True) as conn:
        if not conn.execute("select 1 from pg_database where datname = %s", (name,)).fetchone():
            conn.execute(f'create database "{name}"')


def reset(engine: Engine, fixtures: Path = FIXTURES_DIR) -> None:
    """スキーマを消して、マイグレーション → 初期メタデータ → 種のデータまで作り直す。

    マイグレーションは設定(`WORKS_DATABASE_URL` など)の接続先へ流れるので、`engine` もそこから作ったものを渡す。
    """
    name = engine.url.database or ""
    if not name.endswith(SUFFIX):
        raise SystemExit(f"種のデータを入れられるのは、名前が {SUFFIX} で終わる DB だけです(いま: {name})")
    _ensure_database(engine)
    with engine.begin() as conn:
        conn.execute(text("drop schema public cascade"))
        conn.execute(text("create schema public"))
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    command.upgrade(config, "head")
    with engine.begin() as conn:
        seed.seed(conn)
        load(conn, fixtures)
