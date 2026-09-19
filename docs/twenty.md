# Twenty のセルフホスト(試用・2026-09-20 構築)

オープンソース CRM の [Twenty](https://twenty.com) を Surface(WSL2)の Docker で動かし、`https://works.sanei-clover.com` で開けるようにしてある(Cloudflare Tunnel 経由。Access は置いていない)。
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

ローカルからは `http://localhost:3000`。ただし `SERVER_URL` が公開 URL なので、普段は `https://works.sanei-clover.com` を使う。

**イメージの取得でつまずく点**: この WSL の `~/.docker/config.json` は `credsStore: desktop.exe`(Docker Desktop の名残)で、公開イメージの pull まで
`docker-credential-desktop.exe: executable file not found` で失敗する。ECR の認証が入っているので設定は消さず、pull のときだけ空の設定を使う:

```
mkdir -p /tmp/docker-nocreds && echo '{}' > /tmp/docker-nocreds/config.json
DOCKER_CONFIG=/tmp/docker-nocreds docker pull twentycrm/twenty:<タグ>
```

## 外からの経路(Cloudflare Tunnel。Access は置かない)

Surface から Cloudflare へ外向きに張るだけで受信ポートは開けない。作成済みのもの: Tunnel `perfect-crm-works`、CNAME `works.sanei-clover.com`(プロキシ ON。Tunnel 宛ては必須)。

**Cloudflare Access は 2026-09-20 に外した(本人の判断)。**`works.sanei-clover.com` はインターネットから誰でも届き、守りは Twenty 自身の認証だけになる
(画面はメール + パスワード、`/mcp`・`/rest`・`/graphql` は API キーか OAuth)。外した理由: エージェントが PIN の画面を通れず MCP が繋がらない、PIN の往復が日常の利用に重い。
前提として守ること:

- Twenty のパスワードは使い回さない長いものにする(総当たりを Access が止めてくれない)
- マルチワークスペースは無効のまま(`isMultiWorkspaceEnabled: false`。他人は新しいワークスペースを作れず、既存のワークスペースには招待が無いと入れない)。
  使わないなら Settings → Members の公開招待リンクを無効にする
- `TWENTY_TAG` を放置しない。認証まわりの修正が出たら上げる(外に出ている以上、古い版の穴がそのまま入口になる)
- API キーは用途ごとに作り、漏れたら Settings → API & Webhooks で失効させる

作り直すとき(再実行しても重複を作らない。第 2 引数の `-` は「Access を作らない」):

```
python3 scripts/cloudflare-tunnel-setup.py works.sanei-clover.com - http://server:3000
docker compose --profile public up -d
```

Access を戻すときは第 2 引数に許可メール(カンマ区切り)、第 5 引数に素通しにするパス(`/mcp`)を渡す。Zero Trust のチーム `sanei-clover.cloudflareaccess.com` と
One-time PIN の IdP は残してある。そのときの注意: One-time PIN は許可されていないアドレスにはコードを送らない / PIN は 1 回だけ要求し、コードを同じタブに手入力する。

- API トークンの権限は最小より広い(受け入れたリスク・2026-09-19)。ゾーン `sanei-clover.com` の全権限とアカウントの全権限を持つ。前提は `.env` の外に出さない・漏えいが疑われたら即失効

## 初回のセットアップ(画面で行う)

1. `https://works.sanei-clover.com` → 「Continue with Email」で最初のユーザーとワークスペースを作る(**最初に作った人が管理者**)
2. 2 人目以降はワークスペースからの招待で入れる(マルチワークスペースは無効のまま)

## エージェントからの MCP 接続(Claude Code / Codex)

Twenty は MCP サーバを内蔵している(`POST /mcp`、Streamable HTTP)。公式ドキュメントに接続手順の頁は無いので、v2.41.0 の実装を読んで確認した:
認証は `Authorization: Bearer <API キー>` か OAuth(`/.well-known/oauth-protected-resource`、動的クライアント登録あり)。ここでは API キーを使う。

**接続先は `https://works.sanei-clover.com/mcp`**(同じ Surface からなら `http://localhost:3000/mcp` でも同じ)。API キー無しのリクエストは Twenty が 401 で返す。
クライアントが `Unexpected content type: text/html` で失敗するときは、前段に Access が戻っていて `/mcp` が素通しになっていない。

1. API キーを作る(人の作業): Twenty の Settings → API & Webhooks → + Create key。**表示は一度きり**。`.env` の `TWENTY_API_KEY` に控える。
   権限を絞るなら Settings → Members → Roles → Assignment タブでキーにロールを割り当てる
2. Claude Code(全リポジトリから使うので user スコープ。キーは `~/.claude.json` に入り、このリポジトリには入らない):
   ```
   claude mcp add --transport http --scope user twenty https://works.sanei-clover.com/mcp --header "Authorization: Bearer <API キー>"
   claude mcp list    # ✔ Connected を確認
   ```
3. Codex(`~/.codex/config.toml`。キーは環境変数から渡す):
   ```
   [mcp_servers.twenty]
   url = "https://works.sanei-clover.com/mcp"
   bearer_token_env_var = "TWENTY_API_KEY"
   ```
   `TWENTY_API_KEY` は Codex を起動するシェルに export しておく(例: `~/.bashrc` から、権限 600 の秘密ファイルを読む)
4. 疎通の確認(キーを `.env` に入れたあと):
   ```
   KEY=$(grep '^TWENTY_API_KEY=' .env | cut -d= -f2-)
   curl -s -X POST https://works.sanei-clover.com/mcp -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

**このリポジトリは公開なので、API キーを `.mcp.json`(project スコープ)に書かない。**

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
Twenty への取り込みはまだしていない。
