# perfect-crm

CRM(顧客)+ SFA(案件)+ プロジェクト/タスク管理。自社で使い、他社にも売る。AI は外に住み、入力はエージェントが MCP 経由で行う。

| 場所 | 中身 |
|---|---|
| `docs/design/` | 設計の正本(01 要件と決定 → 02 データモデル → 03 アーキテクチャ → 04 配置 → 05 移行 → 06 UI) |
| `docs/contacts.md` | 現行の連絡先台帳 `contacts/`(PostgreSQL 正本)の運用手順 |
| `docs/dns/` | ドメインの DNS 棚卸し(Cloudflare 移設時の突き合わせ用) |
| `backlog/` | 問い(`QUESTIONS.md`)と作業(`JOBS.md`) |
| `contacts/` | 連絡先台帳の Compose スタック・スキーマ・スクリプト(本体ができるまでの器) |
| `.env.example` | 環境変数の項目。実体は直下の `.env`(git 管理外) |

現状(2026-09-19): 本体は設計のみ。次の一手は `backlog/JOBS.md` の先頭。
