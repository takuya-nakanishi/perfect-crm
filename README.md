# perfect-crm(アーカイブ済み・2026-09-21)

**このリポジトリは 2026-09-21 にアーカイブした。動いているものは無い。**

CRM(顧客)+ SFA(案件)+ プロジェクト/タスク管理を自前で作る構想だったが、コードを書く前にやめた。
後継は **Google スプレッドシートを台帳にし、UI は必要に応じて Google Apps Script で作る**方針(このリポジトリの外で進める)。

## やめた理由

- **セルフホストが面倒。**Surface(WSL2)の Docker・Cloudflare Tunnel・バックアップ・版上げを、利用者 1 名のために回し続ける割に合わない
- **Google ドライブと Gemini からネイティブに検索できる。**スプレッドシートなら、台帳がそのまま普段の検索と AI の文脈に入る。自前の DB や別の CRM に置くと、そのための連携を作る側に回る
- **試した既製品が合わなかった。**NocoDB は有料プランへ誘導する UI が目についた。Twenty は機能は十分だったが使いにくく、無理に運用を続ける理由が無かった

## 経緯(2026-09-19〜21)

| 日付 | 出来事 |
|---|---|
| 09-19 | 設計の初版(`docs/design/`)と backlog を起こす。連絡先台帳 `contacts/`(PostgreSQL 正本 + NocoDB)を移設。sanei-clover.com の権威 DNS を Cloudflare へ移し、壊れたレコードを修復 |
| 09-20 | NocoDB を撤去。Twenty v2.41.0 をセルフホストし、台帳の企業 60・担当者 25 を移行。`contacts/` を撤去。Cloudflare Access を外し、公開ホスト名を `twenty.sanei-clover.com` に |
| 09-21 | Twenty と Cloudflare Tunnel を撤去し、アーカイブ |

## 残っているもの

| 場所 | 中身 |
|---|---|
| `docs/design/` | 自前で作る場合の設計(01 要件と決定 → 06 UI)。決定と理由の記録として読める |
| `docs/twenty.md` | Twenty のセルフホスト手順と、試用で分かったこと(MCP 接続、移行の対応表、Cloudflare Access の落とし穴) |
| `docker-compose.yml` / `scripts/` | Twenty のスタックと、Cloudflare の Tunnel + Access を API で組むスクリプト(再利用可) |
| `docs/dns/` | sanei-clover.com の DNS 棚卸し(2026-09-19、Cloudflare 移設前) |
| `backlog/` | 問いと作業の全履歴。未完は無い(すべて解決・失効・取り下げで閉じた) |

データはこのリポジトリに無い(公開リポジトリのため、個人情報は最初から Git に入れていない)。
