# JOBS

作業を1枚で持つ。書式の正本は `questions-jobs` skill。問いは QUESTIONS.md へ。

## 次の一手

上から順にやる。ループはこの節の**先頭1件だけ**を取る。

- [ ] **J-001** 採用候補のライブラリが非推奨でないことを一次資料で確認する(2026-09-19)
  - 由来: Q-009、共通ルール「非推奨ツールを使わない」
  - 対象: Better Auth(organization / apiKey / MCP プラグイン、追加 scope 取得 = Q-023)、Hono と `@hono/mcp`、`@modelcontextprotocol/sdk`(Streamable HTTP)、Drizzle + drizzle-kit、TanStack Router/Query/Table、pg-boss。Q-022(gmail.send の区分)・Q-024(claude.ai コネクタの認証)もここで見る。結果は docs/design/03 §9 に書き、候補を確定に変える
- [ ] **J-002** モノレポの骨格と Compose を作る(2026-09-19)
  - 由来: Q-009。`packages/core` / `apps/server` / `apps/web`、PostgreSQL 18、`docker compose up` で空のアプリが立つところまで。docs/design/03 §2、04 §1。J-001 の後
- [ ] **J-003** データモデル v1 を Drizzle スキーマにする(2026-09-19)
  - 由来: Q-001・Q-006・Q-007。docs/design/02。`records` supertype、`(organization_id, id)` の複合 FK、RLS、`custom_field_definitions`、`audit_log` 込み
- [ ] **J-004** Google ログインと組織・API トークンを入れる(2026-09-19)
  - 由来: Q-009。Better Auth(候補)。`MODE=single` で組織 1 つを seed。docs/design/03 §6
- [ ] **J-005** コマンド層と MCP サーバ v1 を作る(2026-09-19)
  - 由来: Q-002・Q-003・Q-004。docs/design/03 §3・§5。重複ガードと監査ログを全コマンドに。MCP は API トークン認証
- [ ] **J-006** Notion・Google コンタクト・Todoist からの移行スクリプトを書く(2026-09-19)
  - 由来: Q-012・Q-014。docs/design/05 §2。Q-019・Q-020・Q-021 の答え待ち。切替(旧サービスの凍結)は含めない → J-010
  - 画面より先に置く理由: MCP があれば UI 完成前に Claude Code から試せる
- [ ] **J-007** 画面 v1 を作る(2026-09-19)
  - 由来: Q-003・Q-016。一覧・詳細(タイムライン)・今日のタスク。サイドバーにエンティティ。全画面レスポンシブ。参照は Attio / Linear
- [ ] **J-010** Notion・Todoist から perfect-crm へ切り替える(2026-09-19)
  - 由来: Q-012・Q-014。docs/design/05 §3 の切替条件(Q-018 の必須機能が動く、J-007 で閲覧できる、件数照合、切戻し手順)を満たしてから。J-006 と分けた理由: 必須機能が未決のまま旧サービスを凍結すると日常のタスク操作が途切れる
- [ ] **J-008** Cloudflare Tunnel で自社インスタンスを公開し、バックアップと復元を回す(2026-09-19)
  - 由来: Q-013。docs/design/04 §3・§4。復元を一度実演して runbook に書く
- [ ] **J-009** 2 人目の利用者が入る前に本番を常時稼働のホストへ移す(2026-09-19)
  - 由来: Q-013。docs/design/04 §8。トリガー: 2 人目の利用開始が決まったら。候補は社内の小型機か VPS、同じ Compose
- [ ] **J-011** Google ドライブ連携 v2 — ドキュメント / スプレッドシート / スライドの作成、既存ファイルのリンク、共有(2026-09-19)
  - 由来: Q-008・Q-025。docs/design/01 D-08、03 §7。v1(J-001〜J-010)の後

## 完了

新しいものを上に。消さない(履歴はここに残る)。
