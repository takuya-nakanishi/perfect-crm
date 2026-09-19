# 設計文書

perfect-crm の設計の正本。決定は各文書を更新して残す(`backlog/` にはポインタだけ)。

| 文書 | 内容 |
|---|---|
| [01-requirements.md](01-requirements.md) | 要件と決定(D-01〜D-11)。なぜそう決めたか |
| [02-data-model.md](02-data-model.md) | データモデル。supertype・リンク・カスタム項目・重複判定・検索 |
| [03-architecture.md](03-architecture.md) | パッケージ構成・コマンド層・HTTP API・MCP・認証・Google 連携 |
| [04-deployment.md](04-deployment.md) | Compose・公開経路・バックアップ・引っ越し・SaaS モード・OAuth 審査 |
| [05-migration.md](05-migration.md) | Notion / Google コンタクト / Todoist からの移行。移行元の実構造 |
| [06-ui.md](06-ui.md) | ビューの構成、キーボード操作、カンバンのグルーピング |

状態(2026-09-19): 設計のみ。コードは無い。未決は `backlog/QUESTIONS.md`、次の一手は `backlog/JOBS.md`。
