# 設計文書

Works(自作 CRM)の設計の正本。決定は各文書を更新して残す(`backlog/` にはポインタだけ)。

| 文書 | 内容 |
|---|---|
| [01-requirements.md](01-requirements.md) | 目的、初回ローンチのスコープ、決定(D-01〜D-11)と理由、段階 |
| [02-data-model.md](02-data-model.md) | メタデータ(テーブル・項目・ビューの定義)、4 つのテーブル、業務ルール、PostgreSQL への置き方の下書き |
| [03-architecture.md](03-architecture.md) | 全体像、リポジトリの構成、モックと本物の差し替え、**バックエンドのフレームワーク比較**、認証、MCP、AI チャット、採用ライブラリの確認結果 |
| [04-api.md](04-api.md) | 画面とバックエンドの契約。エンドポイント、フィルタ、並び、集計 |
| [05-ui.md](05-ui.md) | 画面の構成、ビュー、キーボード、見た目の決めごと(色・文字・グラフ)、軽快さの作り、確かめ方 |
| [06-deployment.md](06-deployment.md) | Compose、Cloudflare Tunnel + Access、配る側のヘッダ、稼働の前提、引っ越し |
| [07-migration.md](07-migration.md) | Notion・連絡先台帳・Google コンタクト・Todoist からの移行と、Todoist の廃止 |

運用の手順と落とし穴は [../runbook/01-operations.md](../runbook/01-operations.md)。

状態(2026-09-21): 画面のモックが `https://works.sanei-clover.com` で動いている。バックエンドと DB はこれから。未決は `backlog/QUESTIONS.md`、次の一手は `backlog/JOBS.md`。

文書の採番と命名は、いまは「`NN-名前.md` を読む順に並べる」だけの暫定。人が読みやすい形の検討と規則化は J-030。
2026-09-21 より前の設計(TypeScript 端から端・マルチテナントの構想)と Twenty の試用記録は、git の履歴(`21d044e` 以前)にある。

`08-inventory.md` — 詳細設計に向けた棚卸し(2026-09-22)。矛盾の修正、決めごと、難所、backlog への拡張性。

テストは `../tests/README.md`(4 軸と層、領域別の表)、無人ループは `../runbook/02-loop.md`。
