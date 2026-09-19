# perfect-crm

## このリポジトリは何か

CRM(顧客)+ SFA(案件)+ プロジェクト/タスク管理。**自社で使い、他社にも売る**。
セルフホストでも SaaS でも同じ Docker イメージを動かす。

**AI は外に住む。**CRM 自身は LLM を呼ばない。入力は Claude Code 等のエージェントが
MCP 経由で行い、人は画面で閲覧し台帳を直す(画面からの入力も従来通りできる)。
「AI 密結合」の質は MCP ツールの粒度と説明文で決まる。

設計の正は `docs/design/`(01 要件と決定 → 02 データモデル → 03 アーキテクチャ →
04 配置 → 05 移行)。問いと作業は `backlog/`(書式は `questions-jobs` skill)。
docs で「未決」「要確認」と書かれた箇所は `backlog/QUESTIONS.md` に対応する問いがある。

## 現状(2026-09-19)

設計のみ。コードはまだ無い。次の一手は `backlog/JOBS.md` の先頭。

**`contacts/` は例外で、今日から稼働している現行の連絡先台帳**(PostgreSQL 正本 + NocoDB 画面。本体ができるまでの
実運用の器であり、本体の初期データの移行元)。本体の設計とは独立した Compose スタックで、運用手順は `docs/contacts.md`。

### `contacts/` の台帳へ書くとき(Claude Code / Codex 共通・省略不可)

コマンドは `contacts/` で実行する(`docker-compose.yml` がそこにある。`.env` は直下に 1 つで、`contacts/.env` はそのリンク)。

1. 接続はロール **`contacts_agent`**(`.env` の `CONTACTS_AGENT_DB_PASSWORD`)。所有者 `contacts` は使わない
2. 書き込みトランザクションの先頭で **`SET LOCAL app.actor = 'Claude'`**(Codex は `'Codex'`)を宣言する。
   宣言が無い・他の値を名乗ると DB 側が書き込みを拒否する(`current_actor()`)
3. ID は `next_id('o'|'p'|'a')` で採る。値の制約(enum・一意・参照)は DB が強制するので、失敗したら値を直す。制約を緩めない
4. スキーマ変更(`contacts/db/*.sql`)は人間の承認を得てから。所有者ロールで流し、同じコミットで `docs/contacts.md` を直す

禁止: `.env` の値を出力・コミット・外部送出しない / **`contacts/seed/*.csv`(個人情報)を Git に入れない**(このリポジトリは公開)/
`change_log` を書き換えない(書けないが、迂回も試みない)/ 台帳の内容を llm-wiki の entities へ転記しない
(連絡先は台帳に、知見は wiki に。境界は llm-wiki `vault/wiki/knowledge/personal-data-governance.md`)。

## 守る不変条件(コードを書くとき)

- 全ドメインテーブルに `organization_id`。PostgreSQL の RLS で強制。自社インスタンスは組織 1 つ
- 全エンティティを `records`(supertype)に登録。レコード間の関係は `record_links`。
  `records` への参照は必ず `(organization_id, id)` の複合 FK(RLS は FK 検査を止めない)
- 書き込みは `packages/core` のコマンド経由のみ。UI・MCP・将来の内蔵 AI は同じコマンドを呼ぶ。
  全コマンドが監査ログを残す(誰が・どのエージェントが・何を根拠に)
- 重複を黙って作らない。作成コマンドは重複候補を返す
- Google の scope は `openid email profile` / `drive.file` / `gmail.send` から増やさない。
  読み取りはエージェント側の Gmail / Drive MCP が担う
- 外部文書は ID で保持する。名前・パスで探さない
- 状態は PostgreSQL と S3 互換ストレージだけ。クラウド固有サービスをコアに入れない
- 自社固有の値(会社名・外部サービスの ID・業務フローの前提)はコードに埋めない。
  組織の設定かデータに出す

## スタック

確定: TypeScript 端から端、PostgreSQL、Docker。
候補(**J-001 で一次資料を確認してから確定**): pnpm workspaces、`packages/core`(ドメイン)/
`apps/server`(Hono: API・MCP・認証・Google 連携)/ `apps/web`(Vite + React)、Drizzle、
Better Auth、`@modelcontextprotocol/sdk`、Docker Compose(app / postgres / cloudflared)。
候補を確定に変えるのは J-001 の結果を `docs/design/03` §9 に書いてから。

## 作業の仕方

- 共通ルール(`~/.claude/CLAUDE.md`)に従う。ここでは重複させない
- 決定は `docs/design/` を更新して残す。backlog にはポインタだけ
