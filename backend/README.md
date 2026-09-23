# backend — Works の JSON API

FastAPI + SQLAlchemy 2(Core)+ Alembic + Pydantic v2 + psycopg 3。パッケージ管理は uv(Q-034。`docs/design/03` §4・§10)。

- **契約は [`docs/design/04`](../docs/design/04-api.md)、振る舞いの正は画面のモック**(`frontend/src/mocks/engine.ts`)。食い違ったらモックが正しい
- **ORM のモデルは書かない。**画面が描くテーブルはメタデータ(`meta_objects` / `meta_fields`)で決まるので、SQL は実行時に組む
- **同期で書く。**`async def` は使わない(理由は `docs/design/03` §10)

## 置き場

| 場所 | 中身 |
|---|---|
| `app/config.py` | 環境変数(`WORKS_*`)。リポジトリ直下の `.env` を読む |
| `app/db.py` | 接続。1 リクエスト = 1 トランザクション |
| `app/errors.py` | `ApiError` と、契約どおりの `{code, message}` に揃える例外ハンドラ |
| `app/security.py` | セッション Cookie の署名(パスワードの検証は J-023) |
| `app/meta/tables.py` | **システム表だけ**の定義(`workspace` / `users` / `meta_*` / `ddl_log` / `activity_mentions`) |
| `app/meta/ddl.py` | メタデータ → 実テーブルの DDL。**DDL を流す経路はここ 1 本**。`DROP` は作らない(02 §4) |
| `app/meta/seed.py` | 初期メタデータの投入。正は `app/seed/*.json`(画面の fixtures と同じ。`tests/test_seed.py` が突き合わせる) |
| `app/meta/store.py` | `meta_*` を読んで `GET /meta` の形に。もう無いものを指す定義は**返すときだけ**外す(02 §5) |
| `app/api/` | ルータ。`deps.py` がいまの利用者を決める |
| `migrations/` | Alembic。**システム表だけ**を見る。業務テーブルはアプリが DDL を流す |

## 動かす

```
docker compose --profile backend up -d --build     # api + db(リポジトリのルートで)
```

`.env`(リポジトリ直下に 1 つ)に要る値:

| 変数 | 何に使うか |
|---|---|
| `WORKS_DB_PASSWORD` | PostgreSQL のパスワード。db と api の両方が読む |
| `WORKS_SECRET_KEY` | セッション Cookie の署名。空だと再起動のたびにログインし直しになる |
| `WORKS_ADMIN_EMAIL` / `WORKS_ADMIN_NAME` | 最初の管理者。初回の `app.cli init` だけが使う |

## 手元で動かす・テストする

```
cd backend
uv sync                                  # .venv を作る
docker compose --profile backend up -d db    # (ルートで)テストが繋ぐ PostgreSQL
uv run pytest -q                         # 実物の DB に対して回す
uv run ruff check . && uv run ruff format --check .
uv run mypy app tests
```

`scripts/verify.sh` がこの 3 つをまとめて回す(無人ループと着地の関門)。

- テストは **`_test` で終わる名前の DB にしか繋がない**(スキーマを作り直すため。`tests/conftest.py` の安全装置)。無ければ自動で作る
- 1 テスト = 1 トランザクションで巻き戻す。1 リクエスト = SAVEPOINT
- 接続先を変えるなら `WORKS_TEST_DATABASE_URL`

## マイグレーション

```
uv run alembic revision --autogenerate -m "…"   # システム表を変えたときだけ
uv run alembic upgrade head
```

**画面から足したテーブル・列は Alembic に出てこない**(`meta_*` が正で、アプリが `CREATE TABLE` / `ADD COLUMN` を流す)。
流した文は `ddl_log` に残る。
