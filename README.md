# perfect-crm

CRM(顧客)+ SFA(案件)+ プロジェクト/タスク管理。自社で使い、他社にも売る。AI は外に住み、入力はエージェントが MCP 経由で行う。

| 場所 | 中身 |
|---|---|
| `docs/design/` | 自前で作る本体の設計(01 要件と決定 → 02 データモデル → 03 アーキテクチャ → 04 配置 → 05 移行 → 06 UI) |
| `docs/twenty.md` | 試用中の Twenty(オープンソース CRM)のセルフホスト手順。`https://works.sanei-clover.com` |
| `docker-compose.yml` | Twenty のスタック(server / worker / db / redis / tunnel) |
| `scripts/` | Cloudflare の DNS 突き合わせと Tunnel + Access の構築 |
| `docs/dns/` | ドメインの DNS 棚卸し(Cloudflare 移設時の突き合わせ用) |
| `backlog/` | 問い(`QUESTIONS.md`)と作業(`JOBS.md`) |
| `.env.example` | 環境変数の項目。実体は直下の `.env`(git 管理外) |

現状(2026-09-20): 本体は設計のみ。Twenty を試用中で、本体を作り続けるかは未決(`backlog/QUESTIONS.md` Q-032)。
