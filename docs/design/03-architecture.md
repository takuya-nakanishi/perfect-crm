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

## 3.5 DB への接続は本サービスだけ

**PostgreSQL に触れるのは `apps/server` のプロセスだけ**(01 D-13)。外部のシステム・エージェント・BI ツールは MCP か HTTP API を通す。

- DB の接続情報は `app` コンテナだけが持つ。`postgres` はホストにポートを公開しない(04 §1)
- 同一ホストでの運用作業は例外: マイグレーション(別ロール)、`pg_dump` のバックアップ、移行スクリプト(`packages/core` のコマンドを呼ぶので監査ログは残る)
- これで、監査ログ・重複ガード・RLS を迂回してデータが書き換わる経路が無くなる(D-04 の守りが実際に効く)

## 4. HTTP API(UI 向け)

- Hono RPC。UI は `hc<AppType>` で型付きに呼ぶ。認証は Better Auth のセッション Cookie
- 1 エンドポイント = 1 コマンド / クエリ。ロジックを持たない

## 5. MCP サーバ

- `POST /mcp`(Streamable HTTP)。`@modelcontextprotocol/sdk` を `@hono/mcp` で載せる
- **認証(v1)**: 利用者ごとの API トークン(Better Auth apiKey)。`Authorization: Bearer …`。トークンは組織に属し、操作は `actor = { userId, agent: クライアント名, via: 'mcp' }` で記録される。Claude Code は `claude mcp add --transport http … --header "Authorization: Bearer …"`、Codex も同様
- **認証(v2)**: OAuth 2.1(Better Auth の `mcp()` プラグイン)。claude.ai / Claude Desktop のカスタムコネクタは**静的ヘッダ・API キーの欄を持たず OAuth のみ**なので、同僚がそこから使い始める時点で要る(Q-024)
  - **DCR(動的クライアント登録)は実装しない。**MCP 仕様が非推奨にしている(§10)。Better Auth も既定で無効
  - 代わりに **Client ID Metadata Documents**(クライアントが HTTPS URL を client_id に使う)と**事前登録**(claude.ai の Advanced settings に Client ID / Secret を入れてもらう)の 2 つで足りる
  - サーバが実装必須のもの: RFC 9728 Protected Resource Metadata(`/.well-known/oauth-protected-resource`)、RFC 8707 の `resource` パラメータとトークンの audience 検証、RFC 8414 か OIDC Discovery のどちらか
  - 追加 scope は **step-up flow**: 足りなければ `403` + `WWW-Authenticate: Bearer error="insufficient_scope", scope="…"` を返す。1 回の挑戦で必要な scope をまとめて出す
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

## 8. Web 会議の自動連携(v4・Q-030)

会議から活動を自動で起こす。CRM は LLM を呼ばない(01 D-02)ので、文字起こしの要約はエージェント側か連携先の機能を使い、CRM は結果を `log_activity` で受ける。連携先の候補と方式は Q-030。`activities.external_ref` に会議 ID・録画・文字起こしの参照を持つ。

## 9. 将来の内蔵 AI

`packages/core` を呼ぶ 4 つ目の入口。自然文 → コマンド列の生成、差分提案 UI、要約の書き戻し。v4。

## 10. 一次資料での確認結果(2026-09-19・J-001)

### 採用候補の非推奨確認

npm レジストリの `latest` を直接引いて `deprecated` フラグを見た(共通ルール「根拠は①ツール自身の出力」)。**全部が非推奨ではない。**

| パッケージ | 版 | 判定 |
|---|---|---|
| better-auth | 1.7.5 | ok |
| hono | 4.13.8 | ok |
| @hono/mcp | 0.3.2 | ok |
| @modelcontextprotocol/sdk | 1.30.0 | ok |
| drizzle-orm / drizzle-kit | 0.45.2 / 0.31.10 | ok |
| @tanstack/react-router / react-query / react-table | 1.170.38 / 5.103.1 / 9.2.4 | ok |
| pg-boss | 12.33.2 | ok |
| vite / react / tailwindcss | 8.3.0 / 19.3.0 / 4.3.3 | ok |
| postgres / pg | 3.4.9 / 8.23.0 | ok |

これで 01 D-09 の候補を**確定**に変える。

### 機能の確認

| 問い | 結果 | 出典 |
|---|---|---|
| Q-022 `gmail.send` の区分 | **Sensitive**(Restricted ではない)。Restricted は `gmail.readonly` `gmail.modify` `gmail.compose` `mail.google.com/` など。読み取りをエージェント側に委ねる設計(D-05)により restricted を持たずに済む | Google Workspace「Gmail API scopes」 |
| Q-023 Better Auth | 満たす。organization(組織・メンバー・ロール・招待・アクティブ組織)、apiKey(`verifyApiKey` で自前エンドポイントから検証、組織に紐づく、メタデータ・期限・レート制限)、mcp(OAuth 2.1 プロバイダ、RFC 9728 実装、`requireMcpAuth`) | Better Auth 公式ドキュメント |
| Q-024 claude.ai のコネクタ | **OAuth のみ。**静的 bearer・カスタムヘッダ・API キーの欄は無い。ただし Advanced settings で **OAuth Client ID / Secret を手で設定できる**ので、事前登録クライアントで足り、DCR は要らない | Claude Help Center「Get started with custom connectors using remote MCP」 |

### 非推奨だったもの(設計を変えた)

- **DCR(RFC 7591 動的クライアント登録)**は MCP 仕様で**非推奨**。「Dynamic Client Registration is deprecated and retained for backwards compatibility with authorization servers that do not support Client ID Metadata Documents」。代替は **OAuth Client ID Metadata Documents**(draft-ietf-oauth-client-id-metadata-document-00)で、仕様上は SHOULD。Better Auth も「MCP deprecates Dynamic Client Registration (DCR), so Better Auth never enables DCR implicitly」と書き、既定で無効。**当初の設計(v2 で DCR)を §5 のとおり改めた**
- Better Auth の `organizationCreation` フックは非推奨。`organizationHooks` を使う

### 積み残し

`gmail.send` が Sensitive であることは確認したが、**Sensitive scope の審査に CASA(年次セキュリティ評価)が伴わないこと自体**は未確認。製品化(v3)の直前に Google の審査要件を読み直す → J-014。
