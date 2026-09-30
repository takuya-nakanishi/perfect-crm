# backend — Works の JSON API

FastAPI + SQLAlchemy 2(Core)+ Alembic + Pydantic v2 + psycopg 3。パッケージ管理は uv(Q-034。`docs/design/03` §4・§10)。

- **契約は [`docs/design/04`](../docs/design/04-api.md)、振る舞いの正は画面のモック**(`frontend/src/mocks/engine.ts`)。食い違ったらモックが正しい
- **ORM のモデルは書かない。**画面が描くテーブルはメタデータ(`meta_objects` / `meta_fields`)で決まるので、SQL は実行時に組む
- **同期で書く。**`async def` は使わない(理由は `docs/design/03` §10)

## 置き場

| 場所 | 中身 |
|---|---|
| `app/config.py` | 環境変数(`WORKS_*`)。リポジトリ直下の `.env` を読む |
| `app/google/` | Google ドライブ(04 §8)。`oauth`(繋ぐ)・`store`(鍵を暗号化して持つ)・`drive`(Drive API)・`http`(**唯一の外向きの口**。テストはここを差し替える) |
| `app/db.py` | 接続。1 リクエスト = 1 トランザクション |
| `app/errors.py` | `ApiError` と、契約どおりの `{code, message}` に揃える例外ハンドラ |
| `app/auth/` | 自前のログイン(03 §5)。`passwords`(Argon2id と決まり)・`totp`(2 段階認証)・`sessions`(ブラウザのセッション)・`challenges`(2 段目を待つ札)・`throttle`(続けて失敗したときの待ち)。口は `app/api/session.py`・`account.py`。いまの利用者を決めるのは `app/api/deps.py` |
| `app/access.py` | 本番を切り替える(J-055)までのログイン。Cloudflare Access の JWT を確かめてメールアドレスを取る(`WORKS_AUTH=access`) |
| `app/mcpserver/` | MCP サーバ(`server.py`。ツール 6 つ)と、Claude のカスタムコネクタが通る OAuth の認可サーバ(`oauth.py`)。`/mcp` と OAuth の口は `/api/v1` の外(03 §6、04 §13) |
| `app/slack/` | Slack のチャンネル(04 §14)。`service`(繋ぐ・外す・テスト通知)・`store`(Webhook を暗号化して持つ。1 行 = 1 チャンネル)・`message`(本文の Block Kit とエスケープ)・`http`(**唯一の外向きの口**。テストはここを差し替える) |
| `app/workflows/` | ワークフロー(04 §15)。`model`(定義の検証)・`store`(定義と実行記録)・`engine`(書き込みのたびに判定して実行記録を入れる)・`runner`(送り係。API のプロセスの中のスレッド。03 §11)・`trial`(テスト送信)・`actions/`(アクションの種類。いまは `slack`) |
| `app/records/origin.py` | 書き込みがどこから来たか(画面・Web フォーム・MCP・自動作成・CSV)。`service.insert` / `update` には必ず渡す |
| `app/security.py` | 署名と暗号化の鍵(`WORKS_SECRET_KEY`) |
| `app/meta/tables.py` | **システム表だけ**の定義(`workspace` / `users` / `meta_*` / `ddl_log` / `activity_mentions`) |
| `app/meta/ddl.py` | メタデータ → 実テーブルの DDL。**DDL を流す経路はここ 1 本**。`DROP` は作らない(02 §4) |
| `app/demo.py` | E2E の種のデータ。画面の fixtures を今日基準にずらして入れる。**名前が `_e2e` で終わる DB にしか入れない**(`python -m app.cli reset-demo`、`scripts/e2e-http.sh`) |
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
| `WORKS_SECRET_KEY` | 署名と、Google・Slack の鍵と 2 段階認証の秘密の暗号化。空だと再起動のたびに繋ぎ直し・設定し直しになる。**自前のログインを https で使うなら必須**(空なら起動しない) |
| `WORKS_PUBLIC_URL` | 外から見た URL(既定は手元の `http://127.0.0.1:8610`。compose が本番の値を渡す)。MCP の接続先 `<ここ>/mcp` と OAuth の発行元。**Claude のコネクタに入れる URL と 1 文字も違ってはいけない** |
| `WORKS_AUTH` | `local`(既定。アプリ自身のログイン)か `access`(Cloudflare Access の JWT。本番を切り替える J-055 まで。compose の既定は access) |
| `WORKS_SECURE_COOKIE` | セッションの Cookie に Secure と `__Host-` を付ける(既定 `true`)。手元の http だけ `false` |
| `WORKS_PWNED_CHECK` | パスワードを決めるとき、漏えいした一覧(Have I Been Pwned)に照らす(既定 `true`)。テストは `false` |
| `WORKS_ACCESS_TEAM_DOMAIN` / `WORKS_ACCESS_AUD` | Access のチームと、Access アプリの AUD タグ。`scripts/cloudflare-tunnel-setup.py` が書く。空なら access ではだれも入れない(503) |
| `WORKS_ADMIN_EMAIL` / `WORKS_ADMIN_NAME` | 最初の管理者。初回の `app.cli init` だけが使う |
| `WORKS_GOOGLE_CLIENT_ID` / `WORKS_GOOGLE_CLIENT_SECRET` | Google ドライブ(04 §8)。空ならドライブの API は 503 を返す。作り方は `docs/runbook/01` §6 |
| `WORKS_GOOGLE_REDIRECT_URI` | 許可のあとに Google が戻す先。既定は `https://works.sanei-clover.com/api/v1/google/callback`。**GCP に登録した URL と 1 文字も違ってはいけない** |
| `WORKS_SLACK_CLIENT_ID` / `WORKS_SLACK_CLIENT_SECRET` | Slack のチャンネルを繋ぐ(04 §14)。空なら繋げない。アプリは llm-wiki の稼働通知と共有(`docs/runbook/01` §6b) |
| `WORKS_WORKFLOW_RUNNER` | ワークフローの送り係(スレッド)を起こすか(既定 `true`)。テストは `false` にして `runner.run_due()` を直に呼ぶ |

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
