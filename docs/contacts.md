# contacts/ — 現行の連絡先台帳(正本=PostgreSQL)

**perfect-crm 本体ができるまでの実運用の器**であり、本体の初期データの移行元。本体とは別の Compose スタック(`name: contacts`)で動く。
2026-09-19 に単独リポジトリ `contacts-crm` から `contacts/` へ移設(履歴は持ち込まず、Drive `連絡先台帳-移行元-2026-09/` の bundle に退避)。
エージェントが台帳へ書くときの規約はリポジトリ直下の `CLAUDE.md`「`contacts/` の台帳へ書くとき」。

Surface(WSL2)の Docker 上で動く PostgreSQL 16 が**唯一の正本**。Claude Code も Codex も(置くなら画面ツールも)ここへ読み書きする。
設計の由来と判断基準は llm-wiki `vault/wiki/knowledge/personal-data-governance.md`、取扱規律は同ページと
Google スプレッドシート「THE計画／連絡先台帳」の「規律」タブ(2026-09-18制定)。

**コマンドはすべて `contacts/` で実行する**(`docker-compose.yml` がそこにある。以下のパスは `contacts/` 起点)。
`.env` はリポジトリ直下に 1 つだけなので、**compose は必ず `docker compose --env-file ../.env …`** と打つ(付け忘れると `CONTACTS_DB_PASSWORD` 未設定で止まる)。スクリプトは直下の `.env` を自分で読む。

## 構成

- `docker-compose.yml` — `contacts-db`(postgres:16-alpine)。ホストの `127.0.0.1:5433` にのみ公開
- `db/001-schema.sql` — テーブル(organizations / people / activities / change_log)、enum、監査トリガー、採番関数 `next_id()`、ビュー `people_overview`
- `db/002-roles.sql` — ロール(権限の高さで3段)
- `seed/` — 初期投入 CSV の置き場(**個人情報のため Git 管理外**。下記「初期投入データ」)
- `../.env` — 各パスワード(git 管理外。リポジトリ直下に 1 つ。`contacts/` には置かない)。項目はリポジトリ直下の `.env.example`
- `../docs/dns/` — sanei-clover.com の DNS 棚卸し(Cloudflare 移設時の突き合わせ用)

## ロール(権限の高さで分ける。使う人ごとには分けない)

| ロール | できること | 操作者の記録 | 使うのは |
|---|---|---|---|
| `contacts` | 所有者。スキーマ変更・ロール管理 | 未申告なら `本人` | 人間(`docker exec -i contacts-db psql -U contacts -d contacts`) |
| `contacts_agent` | 台帳3表の読み書きのみ | `Claude` か `Codex` の**申告が必須**。他の値・未申告は書き込み自体が失敗 | Claude Code / Codex(共用) |
| `contacts_ui` | 台帳3表の読み書きのみ | `画面` 固定 | 画面ツール(今は無い。次に置く画面が使う) |

`change_log` は3ロールとも直接は書けない(所有者権限のトリガーが記録する)。DDL・トリガー無効化は所有者のみ。

## AI からの読み書き(Claude Code / Codex 共通)

```
PW=$(grep '^CONTACTS_AGENT_DB_PASSWORD=' ../.env | cut -d= -f2)
docker exec -i -e PGPASSWORD="$PW" contacts-db psql -h 127.0.0.1 -U contacts_agent -d contacts <<'SQL'
BEGIN;
SET LOCAL app.actor = 'Claude';   -- Codex は 'Codex'
...
COMMIT;
SQL
```
所有者 `contacts` は使わない(`.env` の `CONTACTS_DB_PASSWORD` はスキーマ変更の時だけ人間が使う)。
ID は `next_id('o'|'p'|'a')` で採る。人物+所属+活動をまとめて読むなら `people_overview`。

## 監査

`change_log` に追加・更新(変わった列のみの差分)・削除がトリガーで自動記録される。どの経路で書いても残り、
操作者は `本人 / Claude / Codex / 画面` のいずれか(`current_actor()` がロールごとに申告できる値を縛る)。

## 画面ツール(今は置いていない)

**NocoDB は 2026-09-20 に撤去した。**理由: 有料プランへ誘導する UI が目につき、日常的に開きたくなる画面ではなかった。
撤去したもの: `contacts-ui` コンテナとボリューム、メタ情報の DB `nocodb_meta`、セットアップ用スクリプト、`.env` の NocoDB 用項目、
公開経路 `works.sanei-clover.com`(Cloudflare Tunnel `perfect-crm-contacts`・CNAME・Access アプリ)。台帳 `contacts` には触れていない(組織 60・人物 25 のまま)。

残したもの(次の画面でそのまま使える):

- ロール `contacts_ui`(操作者 `画面` 固定)と `.env` の `CONTACTS_UI_DB_PASSWORD`
- Zero Trust のチーム `sanei-clover.cloudflareaccess.com` と One-time PIN の IdP(アカウント単位の設定)
- `scripts/cloudflare-tunnel-setup.py` と compose の `tunnel` サービス(下記)

次の画面を選ぶときの条件: 台帳に独自テーブルを作らせない(メタ情報は別 DB へ)、接続は `contacts_ui` ロールで、監査ログに `画面` として残ること。

## 外からの経路(Cloudflare Tunnel + Access。画面を置いたときの手順)

Surface から Cloudflare へ外向きに張るだけで受信ポートは開けない。Access(メールのワンタイム PIN)を通った人だけが画面に到達する。
前提は `sanei-clover.com` の権威 DNS が Cloudflare にあること(2026-09-19 に移設済み)。

1. リポジトリ直下の `.env` に `CLOUDFLARE_API_TOKEN`(権限は `.env.example` の Cloudflare 節。現行トークンの扱いは下記)
2. `python3 scripts/cloudflare-tunnel-setup.py <公開ホスト名> <許可メール> <compose 内の宛先 例 http://ui:8080> [Access アプリ名]`
   → Tunnel・経路・CNAME・One-time PIN・Access アプリ・許可ポリシー・直下 `.env` の `CLOUDFLARE_TUNNEL_TOKEN`。再実行しても重複を作らない
3. `docker compose --env-file ../.env --profile public up -d`(profile を付けないと tunnel は起動しない)

- Access が未有効のアカウントでは、先に `POST /accounts/{id}/access/organizations`(`name` と `auth_domain`)でチームを作る。ダッシュボードの「Enable Access」と同じ
- 許可するメールを増やすときは Access アプリの許可ポリシーに足す。One-time PIN は**ポリシーで許可されていないアドレスにはコードを送らない**(「送信した」画面は出るが届かない)
- PIN は 1 回だけ要求し、メールのリンクを別のブラウザ(Gmail アプリ内ブラウザ等)で開かず、コードを同じタブに手入力する。連続要求や別ブラウザで開くと「That account does not have access」や白画面になる
- サービスを増やすときはパス(`/xxx`)でなくサブドメインで分ける。入口は Access の App Launcher
- 移設の突き合わせ: `python3 scripts/cloudflare-dns-check.py ../docs/dns/sanei-clover.com-2026-09-19.zone [--apply|--verify]`

**API トークンの権限(受け入れたリスク・2026-09-19)**: `.env` のトークン `sanei-clover.com` は、ゾーン `sanei-clover.com` の全権限とアカウントの全権限
(トークン発行を含む)を持つ。`.env.example` に書いた最小権限(DNS:Edit + Tunnel + Access)まで絞らないと決めた。理由は絞り込みの手間に対して利用者が
本人 1 人であること。前提は、トークンを `.env` の外に出さない・漏えいが疑われたら即座に Cloudflare で失効させること。

## 初期化の順序(再構築時)

1. `docker compose --env-file ../.env up -d db` → スキーマは `db/001-schema.sql` が自動適用
2. `db/002-roles.sql` を手で流す(`contacts_agent` / `contacts_ui` ロール。パスワードは `-v` で渡す)

## 初期投入データ(`seed/`、Git 管理外)

`organizations.csv` / `people.csv`(2026-09-18 のスプレッドシート台帳から。組織60・人物25)は**個人情報を含むため Git に入れない**
(`contacts/.gitignore` で `seed/*.csv` を除外。ディレクトリは `.gitkeep` で残す)。原本は Google Drive `マイドライブ/連絡先台帳-移行元-2026-09/`。
再投入するときはそこから `seed/` へ置いて `docker cp seed contacts-db:/tmp/seed` → `\copy`。
