# 03 アーキテクチャ

## 1. 全体像

```
Claude Code / Codex / claude.ai ──MCP(Streamable HTTP)──┐
ブラウザ / スマホ ──────────HTTP API(Hono RPC)──────────┤
問い合わせフォーム ──────────Webhook(v2)─────────────────┤
                                                          ▼
                                              apps/server(Hono)
                                                          │ 呼ぶだけ
                                                          ▼
                                     packages/core(コマンド / クエリ)
                                                          │ Drizzle + RLS
                                                          ▼
                                                PostgreSQL 18

apps/server ──Google API(drive.file / gmail.send)──▶ Google
```

3 つの入口は全部 `packages/core` を呼ぶ。core は HTTP を知らない。将来の内蔵 AI も core を呼ぶ 4 つ目の入口に過ぎない。

## 2. パッケージ

ライブラリは J-001 で確定するまで候補(01 D-09)。

| パス | 役割 | 主な依存(候補) |
|---|---|---|
| `packages/core` | ドメイン。コマンド・クエリ・Drizzle スキーマ・マイグレーション・重複判定・監査 | drizzle-orm、zod、pg |
| `apps/server` | Hono。UI 向け API、MCP エンドポイント、Better Auth、Google 連携、Webhook、ビルド済み UI の配信 | core、hono、@hono/mcp、@modelcontextprotocol/sdk、better-auth、googleapis |
| `apps/web` | Vite + React + TanStack Router / Query / Table + shadcn/ui + Tailwind | server の型(Hono RPC) |
| `scripts/` | 移行・保守。core を直接呼ぶ | core |

## 3. コマンド / クエリ層

- すべての操作は `Context` を受ける: `{ organizationId, actor: { userId?, agent?, via: 'ui' | 'mcp' | 'api' | 'import' | 'system' }, evidence? }`
- コマンドは 1 トランザクション。冒頭で `SET LOCAL app.organization_id` を発行し、RLS を効かせる
- 入力は zod で検証。カスタム項目は `custom_field_definitions` に照らして検証
- 作成コマンドは重複候補を探す(02 §4)。候補があれば `DuplicateCandidates` を返して作らない
- 成功時に `audit_log` を 1 行書く(before / after / actor / evidence)
- クエリは読み取り専用トランザクション。`getContext(recordId)` はレコード・リンク先・直近の活動・タスク・文書を Markdown に組む(ingest 用)

主なコマンド(v1): `createCompany` `updateCompany` `createContact` `updateContact` `setAffiliation` `createLead` `convertLead` `disqualifyLead` `createDeal` `moveDealStage` `createProject` `createTask` `updateTask` `completeTask` `logActivity` `linkRecords` `unlinkRecords` `setCustomFields` `deleteRecord` `restoreRecord`

主なクエリ(v1): `searchRecords` `getRecord` `getContext` `listRecords`(型・フィルタ・並び・ページ)`getTimeline` `myTasks`(today / overdue / upcoming)`getPipeline` `findDuplicates` `listDealStages` `listCustomFieldDefinitions`

## 4. HTTP API(UI 向け)

- Hono RPC。UI は `hc<AppType>` で型付きに呼ぶ。認証は Better Auth のセッション Cookie
- 1 エンドポイント = 1 コマンド / クエリ。ロジックを持たない

## 5. MCP サーバ

- `POST /mcp`(Streamable HTTP)。`@modelcontextprotocol/sdk` を `@hono/mcp` で載せる
- **認証(v1)**: 利用者ごとの API トークン(Better Auth apiKey)。`Authorization: Bearer …`。トークンは組織に属し、操作は `actor = { userId, agent: クライアント名, via: 'mcp' }` で記録される。Claude Code は `claude mcp add --transport http … --header "Authorization: Bearer …"`、Codex も同様
- **認証(v2)**: OAuth 2.1 + 動的クライアント登録。claude.ai / Claude Desktop のカスタムコネクタは静的ヘッダを渡せない見込みのため(Q-024)
- 書き込みツールは `evidence`(根拠: 元メール ID、会話の要約)を任意で受け、`audit_log.evidence` に残す
- Cloudflare Access の後ろに置く場合、`/mcp` は Access を bypass しアプリの認証に任せる(04 §3)
- 長時間接続: サーバから定期 ping(Cloudflare 経由の無通信切断への備え)

ツール(v1)。説明文は業務語彙で書く。ここが AI の UX そのもの(01 D-02)。

| ツール | 役割 |
|---|---|
| `search_records(query, types?)` | 横断検索 |
| `get_record(id)` | レコード+リンク+カスタム項目+直近の活動 |
| `get_context(id)` | 全文脈を Markdown で(ingest 用) |
| `list_records(type, filter?, sort?, page?)` | 一覧 |
| `create_company` / `create_contact` / `create_lead` / `create_deal` / `create_project` / `create_task` | 作成。重複候補があれば作らず返す |
| `update_record(id, patch)` | 更新(カスタム項目含む) |
| `set_affiliation(contact_id, company_id, is_primary?, department?, title?, started_on?, ended_on?)` | 所属の作成・更新・終了。主所属の切替もここ |
| `link_records(from, to, role?)` / `unlink_records` | 関連づけ(role 省略時は `related`) |
| `log_activity(kind, occurred_at, body, links, direction?, external_ref?)` | 活動の記録。最重要 |
| `find_duplicates(type, fields)` | 重複候補 |
| `convert_lead(lead_id, company_id?, contact_id?, deal?)` | リード変換 |
| `move_deal_stage(deal_id, stage)` / `list_deal_stages` | 案件の進行 |
| `my_tasks(scope)` / `complete_task(id)` | タスク |

v2 で足すツール: `create_file(record_id, kind, title?, template?)`(ドキュメント / スプレッドシート / スライドの作成)、`link_file(record_id, url, title?)`、`list_files(record_id)`、`send_email(...)`。

## 6. 認証・認可

- Better Auth。Google でログイン(`openid email profile`)。organization プラグインで組織・メンバー・招待。ロールは owner / admin / member
- レコードは組織内の全員に見える。権限の細分化はしない(v1)
- 1 人が複数組織に属せる(SaaS 時)。UI は組織を切り替える
- 製品では Google を使わない顧客向けにメール+パスワードも足す(v3)

## 7. Google 連携

### scope

| scope | 用途 | 区分 |
|---|---|---|
| `openid email profile` | ログイン | — |
| `drive.file` | アプリが作ったファイル・フォルダの作成・参照・共有・エクスポート。Google Picker で利用者が選んだ既存ファイルへのアクセスもこの scope 内 | 非 sensitive |
| `gmail.send` | 送信 | sensitive(確認は Q-022) |

これ以上増やさない。読み取り(受信メール・任意の Drive ファイル)はエージェント側の Gmail / Drive MCP が担う(01 D-05)。

### 追加 scope の取得

ログイン時は `openid email profile` だけ。Docs / Gmail を初めて使うときに `drive.file` / `gmail.send` を段階的に求める(Better Auth の追加 scope 取得を使う。満たさなければ自前の OAuth フロー。Q-023)。

### ファイルの作成とリンク(v2)

1. `google_drive_folders` から root(`PerfectCRM`)・エンティティ別・レコード別フォルダの ID を引く。無ければ作って記録する。名前で探さない
2. `files.create` で `mimeType` を `application/vnd.google-apps.document` / `.spreadsheet` / `.presentation` のいずれかにし、テンプレート(CRM 側に持つ)を変換アップロード(HTML / CSV / PPTX)。`documents` `spreadsheets` `presentations` の scope は使わない
3. `permissions.create` で組織設定 `document_sharing` に従って共有(members: メンバーの Google アカウントへ個別に `user` 権限 / group: 指定グループ / domain: 指定ドメイン / none)。既定 members。メンバー追加時に既存ファイルへは付与しない(必要時に再共有)
4. `external_files` に `origin: created` で記録し、`activities` に `system` の 1 行
5. 新規タブで開く。iframe 埋め込みはしない(壊れやすい)

既存ファイルのリンク: UI では Google Picker で選び(`drive.file` の範囲で選んだファイルにアクセスできる)、file id・名前・mimeType を `external_files` に `origin: linked` で記録する。MCP や URL 貼り付けでは URL と呼び手が渡した名前だけを記録する(メタデータは取れない)。

### Gmail 送信(v2)

1. 宛先は `contact_identities` の email から選ぶ
2. `users.messages.send`(RFC 2822 を base64url)
3. 返ってきた `id` / `threadId` を `activities.external_ref` に、`kind: email, direction: outbound` で記録

## 8. 将来の内蔵 AI

`packages/core` を呼ぶ 4 つ目の入口。自然文 → コマンド列の生成、差分提案 UI、要約の書き戻し。v4。

## 9. 要確認(採用前に一次資料で)

J-001 で確認し、結果をここに書く。

- Better Auth: organization / apiKey / MCP(OAuth プロバイダ)プラグイン、追加 scope の段階取得(Q-023)
- `@hono/mcp` と `@modelcontextprotocol/sdk` の Streamable HTTP
- claude.ai / Claude Desktop のコネクタ認証(Q-024)
- `gmail.send` の scope 区分(Q-022)
