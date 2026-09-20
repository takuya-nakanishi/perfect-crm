# Twenty のセルフホスト(試用・2026-09-20 構築)

**2026-09-21 に撤去した。**コンテナ・ボリューム・イメージ、Cloudflare の Tunnel `sanei-clover-lan` と CNAME `twenty.sanei-clover.com` を削除済み。
以下は稼働していた当時の手順と記録(`.env` の `TWENTY_*` も消してある)。Zero Trust のチームと One-time PIN の IdP、Cloudflare の API トークンは残っている。

オープンソース CRM の [Twenty](https://twenty.com) を Surface(WSL2)の Docker で動かし、`https://twenty.sanei-clover.com` で開けるようにしてある(Cloudflare Tunnel 経由。Access は置いていない)。
**試用**の位置づけ。自前で作る perfect-crm 本体(`docs/design/`)を続けるか Twenty に寄せるかは未決(`backlog/QUESTIONS.md` Q-032)。

## 構成

- `docker-compose.yml`(リポジトリ直下、`name: twenty`)— `server` / `worker`(`twentycrm/twenty`)、`db`(postgres:16)、`redis`、`tunnel`(cloudflared、profile `public`)
- 公式の `packages/twenty-docker/docker-compose.yml` が元。差分は compose 冒頭のコメント(タグ固定 / `127.0.0.1` のみ公開 / 変数名に `TWENTY_` / legacy の `APP_SECRET` を渡さない / tunnel 追加)
- `.env`(直下に 1 つ、git 管理外)— 項目は `.env.example`。`TWENTY_ENCRYPTION_KEY` は**失うと保存済みの接続情報を復号できなくなる**ので、バックアップと一緒に控える
- 状態は Docker ボリューム `twenty_db-data`(PostgreSQL)と `twenty_server-local-data`(添付ファイル)の 2 つだけ

## 起動と停止

```
docker compose --profile public up -d     # profile を付けないと tunnel が起動しない
docker compose --profile public ps
docker compose --profile public down      # ボリュームは残る。-v を付けるとデータが消える
```

ローカルからは `http://localhost:3000`。ただし `SERVER_URL` が公開 URL なので、普段は `https://twenty.sanei-clover.com` を使う。

**イメージの取得でつまずく点**: この WSL の `~/.docker/config.json` は `credsStore: desktop.exe`(Docker Desktop の名残)で、公開イメージの pull まで
`docker-credential-desktop.exe: executable file not found` で失敗する。ECR の認証が入っているので設定は消さず、pull のときだけ空の設定を使う:

```
mkdir -p /tmp/docker-nocreds && echo '{}' > /tmp/docker-nocreds/config.json
DOCKER_CONFIG=/tmp/docker-nocreds docker pull twentycrm/twenty:<タグ>
```

## 外からの経路(Cloudflare Tunnel。Access は置かない)

Surface から Cloudflare へ外向きに張るだけで受信ポートは開けない。作成済みのもの: Tunnel `sanei-clover-lan`、CNAME `twenty.sanei-clover.com`(プロキシ ON。Tunnel 宛ては必須)。

**Tunnel はこの LAN で 1 本に集約する**(2026-09-20 に `perfect-crm-works` → `sanei-clover-lan` へ改名。ID とトークンは変わらないので CNAME も `.env` もそのまま)。
サービスを増やすときは同じ Tunnel にホスト名を足す。`scripts/cloudflare-tunnel-setup.py` は**既存の経路を残したまま**指定ホストの行だけ差し替える(最後は catch-all の 404)。
他のサービスを載せる場合、cloudflared は宛先に compose のネットワーク越しで届く必要がある点に注意(別スタックなら共有ネットワークかホストの IP 経由にする)。

**公開ホスト名は 2026-09-20 に `works.sanei-clover.com` から `twenty.sanei-clover.com` へ変えた。**works の CNAME は削除済み(名前解決しない)。
変えるときに触るのは 3 つ: ①Tunnel の ingress(スクリプト再実行)②CNAME(新規作成 + 旧削除)③`.env` の `TWENTY_SERVER_URL` と `server` / `worker` の作り直し。
`SERVER_URL` は画面のリンクと OAuth・MCP のメタデータに出るので、DNS だけ変えても不整合が残る。**claude.ai のカスタムコネクタは URL を持っているので、登録し直しが要る。**

**Cloudflare Access は 2026-09-20 に外した(本人の判断)。**`twenty.sanei-clover.com` はインターネットから誰でも届き、守りは Twenty 自身の認証だけになる
(画面はメール + パスワード、`/mcp`・`/rest`・`/graphql` は API キーか OAuth)。外した理由: エージェントが PIN の画面を通れず MCP が繋がらない、PIN の往復が日常の利用に重い。
前提として守ること:

- Twenty のパスワードは使い回さない長いものにする(総当たりを Access が止めてくれない)
- マルチワークスペースは無効のまま(`isMultiWorkspaceEnabled: false`。他人は新しいワークスペースを作れず、既存のワークスペースには招待が無いと入れない)。
  使わないなら Settings → Members の公開招待リンクを無効にする
- `TWENTY_TAG` を放置しない。認証まわりの修正が出たら上げる(外に出ている以上、古い版の穴がそのまま入口になる)
- API キーは用途ごとに作り、漏れたら Settings → API & Webhooks で失効させる

作り直すとき(再実行しても重複を作らない。第 2 引数の `-` は「Access を作らない」):

```
python3 scripts/cloudflare-tunnel-setup.py twenty.sanei-clover.com - http://server:3000
docker compose --profile public up -d
```

Access を戻すときは第 2 引数に許可メール(カンマ区切り)、第 5 引数に素通しにするパス(`/mcp`)を渡す。Zero Trust のチーム `sanei-clover.cloudflareaccess.com` と
One-time PIN の IdP は残してある。そのときの注意: One-time PIN は許可されていないアドレスにはコードを送らない / PIN は 1 回だけ要求し、コードを同じタブに手入力する。

- API トークンの権限は最小より広い(受け入れたリスク・2026-09-19)。ゾーン `sanei-clover.com` の全権限とアカウントの全権限を持つ。前提は `.env` の外に出さない・漏えいが疑われたら即失効

## 初回のセットアップ(画面で行う)

1. `https://twenty.sanei-clover.com` → 「Continue with Email」で最初のユーザーとワークスペースを作る(**最初に作った人が管理者**)
2. 2 人目以降はワークスペースからの招待で入れる(マルチワークスペースは無効のまま)

## エージェントからの MCP 接続(Claude Code / Codex)

Twenty は MCP サーバを内蔵している(`POST /mcp`、Streamable HTTP)。公式ドキュメントに接続手順の頁は無いので、v2.41.0 の実装を読んで確認した:
認証は `Authorization: Bearer <API キー>` か OAuth(`/.well-known/oauth-protected-resource`、動的クライアント登録あり)。ここでは API キーを使う。

**接続先は `https://twenty.sanei-clover.com/mcp`**(同じ Surface からなら `http://localhost:3000/mcp` でも同じ)。API キー無しのリクエストは Twenty が 401 で返す。
クライアントが `Unexpected content type: text/html` で失敗するときは、前段に Access が戻っていて `/mcp` が素通しになっていない。

0. **claude.ai のカスタムコネクタ(登録済み)**: claude.ai の Settings → Connectors に `https://twenty.sanei-clover.com/mcp` を登録してある(認証は OAuth)。
   Claude Code にはコネクタ名がそのまま出る(2026-09-20 時点は `claude.ai Twenty SC`)。**コネクタを改名するとツール名の接頭辞も変わる**ので、
   `claude -p --allowedTools` に書く名前は `claude mcp list` で確かめてから使う(古い名前のままだと権限が当たらず実行されない)。
   ツールは `mcp__claude_ai_<コネクタ名>__*` の 7 つ(`get_tool_catalog` → `learn_tools` → `execute_tool` の順に使う。
   企業・担当者の CRUD、カスタム項目の新設、ビュー、ワークフローまで `execute_tool` 経由で届く)。**登録より前から開いているセッションにはツールが載らない**ので、セッションを開き直す。
   以下の 1〜3 は、コネクタを使わず API キーで直接つなぐ場合(Codex はこちら)
1. API キーを作る(人の作業): Twenty の Settings → API & Webhooks → + Create key。**表示は一度きり**。`.env` の `TWENTY_API_KEY` に控える。
   権限を絞るなら Settings → Members → Roles → Assignment タブでキーにロールを割り当てる
2. Claude Code(全リポジトリから使うので user スコープ。キーは `~/.claude.json` に入り、このリポジトリには入らない):
   ```
   claude mcp add --transport http --scope user twenty https://twenty.sanei-clover.com/mcp --header "Authorization: Bearer <API キー>"
   claude mcp list    # ✔ Connected を確認
   ```
3. Codex(`~/.codex/config.toml`。キーは環境変数から渡す):
   ```
   [mcp_servers.twenty]
   url = "https://twenty.sanei-clover.com/mcp"
   bearer_token_env_var = "TWENTY_API_KEY"
   ```
   `TWENTY_API_KEY` は Codex を起動するシェルに export しておく(例: `~/.bashrc` から、権限 600 の秘密ファイルを読む)
4. 疎通の確認(キーを `.env` に入れたあと):
   ```
   KEY=$(grep '^TWENTY_API_KEY=' .env | cut -d= -f2-)
   curl -s -X POST https://twenty.sanei-clover.com/mcp -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

**このリポジトリは公開なので、API キーを `.mcp.json`(project スコープ)に書かない。**

## 台帳からの移行(2026-09-20 実施)

撤去した連絡先台帳の企業 60 件・担当者 25 件を Twenty に入れた。退避したダンプを一時コンテナに復元 → MCP へ渡す引数をスクリプトで決定的に生成 →
別プロセスの Claude Code(`claude -p`)に「引数を一字一句そのまま `execute_tool` へ渡す」だけをさせ、結果は Twenty の DB を旧 ID で元データと突き合わせた
(件数・重複・欠け・項目ごとの不一致がすべて 0)。スクリプトは `~/backups/perfect-crm/migration/`(`build.py` / `run-phase.sh` / `verify.py`。個人情報を扱うので Git に入れない)。

| 台帳 | Twenty |
|---|---|
| 企業の名称 / 担当者の氏名 | Company `name` / Person `name.lastName`(25 件とも姓名の区切りが無いので分けていない。`firstName` は空) |
| 旧 ID(`o0001` / `p0001`) | カスタム項目 `legacyId`(台帳ID)。突き合わせと再実行時の重複確認に使う |
| 略称・Drive フォルダ(パス文字列)・wiki 名・メモ | カスタム項目 `shortName` / `driveFolder` / `wikiEntity` / `memo`(テキスト。メモは最長 49 字なので Note にしなかった) |
| フリガナ・役職・所属企業 | `nameKana`(カスタム)/ `jobTitle` / `company` |
| 種別・状態 | カスタム項目(選択)`orgKind` / `orgStatus` / `personKind` / `personStatus`。値は英大文字(`CLIENT` `ACTIVE` …)、表示は日本語 |

メール・電話・接触日・活動は元データが全件空だったので移していない。

Twenty が初期に入れるサンプル(`SYSTEM` が作る企業 5・人物 5・商談 6)は同日に削除した。MCP には物理削除が無いのでソフトデリート(ゴミ箱行き)で、
DB には `deletedAt` 付きで残る。完全に消すなら画面のレコードメニュー → Permanently destroy。削除前のダンプは `~/backups/perfect-crm/twenty-2026-09-20-before-seed-delete.dump`。
**まだ残しているサンプル**: ワークフロー 2 本(`Quick Lead` / `Create company when adding a new person`。どちらも ACTIVE で、条件が合えば勝手にレコードを作る)、
ダッシュボード `My First Dashboard`、タイトルの空のタスク 1 件。

削除系ツールの注意: `delete_many_*` は ID ではなく `filter` を取り、その filter に `id` は無い(人物なら `legacyId`、企業なら `name` 等で絞る)。
ID 指定で確実に消すなら `delete_one_*` を 1 件ずつ呼ぶ。`destroy_*`(物理削除)は MCP に無い。

## バックアップと更新

```
docker compose exec -T db pg_dump -U postgres -d default -Fc > ~/backups/perfect-crm/twenty-$(date +%F).dump
```

更新は `.env` の `TWENTY_TAG` をリリースタグ(`vX.Y.Z`。`latest` は使わない)に変えて `docker compose --profile public up -d`。
マイグレーションは server が起動時に流す。**上げる前に必ずダンプを取る**(戻すときはボリュームを作り直してリストア)。

## 撤去したもの(2026-09-20)

Twenty を入れる前に、このリポジトリで動かしていた連絡先台帳 `contacts/`(PostgreSQL 正本、組織 60・人物 25・変更ログ 95)を撤去した。
コンテナ・ボリューム・compose・スキーマ・スクリプトを削除(Git の履歴には残る。最後にあったコミットは `9b3b765`)。NocoDB は同日の先に撤去済み。

退避(リポジトリ外・個人情報を含むので Git に入れない): `~/backups/perfect-crm/` に `contacts-2026-09-20.dump`(`pg_dump -Fc`)、
`contacts-roles-2026-09-20.sql`(ロール)、`contacts-env-2026-09-20.env`(当時のパスワード)。元データの原本は Drive `マイドライブ/連絡先台帳-移行元-2026-09/`。
Twenty へは 2026-09-20 に取り込み済み(下記「台帳からの移行」)。
