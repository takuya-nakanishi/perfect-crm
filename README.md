# perfect-crm — 自作 CRM「Works」

取引先・取引先責任者・商談・タスクを 1 つの場所で扱う CRM。**あり物(GAS・NocoDB・Twenty)を使わず、完全に AI で自作する**挑戦として作っている。
これまでの顧客管理(Notion・Google コンタクト)を置き換え、Todoist も廃止するのが到達点。

命は 3 つ: きれいで「イケてる」画面、使いやすさ、サクサク動く軽快さ。

## いまの状態(2026-09-21)

**画面のモックが `https://works.sanei-clover.com` で動いている**(Cloudflare Access で本人だけが開ける)。
データはブラウザの中の擬似 DB で、会社も人物も架空。バックエンド(Python)と PostgreSQL はこれから。

- 左のサイドバーに DB のテーブルが並び、テーブルを開くと **一覧・カンバン・レポート**をタブで切り替えられる
- タスクは Salesforce と同じく各レコードに紐づき、操作は Todoist 流。チェックで即座に消え、`Q` で追加、`/` で検索。マウスなしで一周できる
- 画面はテーブル・項目・ビューの定義(メタデータ)を読んで描いている。モックのデータは DB の行と同じ形なので、バックエンドができたら差し替えるだけ

## 動かす

```
# 画面の開発(モックで完結する)
cd frontend && npm install && npm run dev        # http://127.0.0.1:5173

# コンテナで(WSL2 の Docker。Windows 側の Docker Desktop は使わない)
docker compose up -d --build                     # http://127.0.0.1:8610
docker compose --profile public up -d --build    # + Cloudflare Tunnel(公開 URL)
```

確かめる: `cd frontend && npm run build && npm run lint && npm run e2e`。手順の全体と落とし穴は `docs/runbook/01-operations.md`。

## 中身

| 場所 | 中身 |
|---|---|
| `frontend/` | 画面。Vite + React + TypeScript + Tailwind CSS v4。モック(`src/mocks/`)と E2E(`e2e/`)を含む |
| `docker-compose.yml` | `web`(Caddy で画面を配る)/ `tunnel`(cloudflared)/ `db`(PostgreSQL。まだ使っていない) |
| `scripts/` | Cloudflare の Tunnel・DNS・Access を API で組むスクリプトと、Access 越しの疎通確認 |
| `docs/design/` | 設計の正本(01 要件と決定 → 07 移行) |
| `docs/runbook/` | 運用の手順と落とし穴 |
| `docs/dns/` | sanei-clover.com の DNS の棚卸し(2026-09-19、Cloudflare へ移す前) |
| `backlog/` | 問い(`QUESTIONS.md`)と作業(`JOBS.md`) |

このリポジトリは公開。**個人情報と秘密の値は入れない**(`.env` は Git の外、実データは `~/backups/perfect-crm/`)。

## 経緯

| 日付 | 出来事 |
|---|---|
| 2026-09-19 | TypeScript 端から端・マルチテナントの CRM として設計の初版を書く。sanei-clover.com の権威 DNS を Cloudflare へ移す |
| 09-20 | 既製品を試す。NocoDB は有料プランへの誘導が目につき撤去。Twenty をセルフホストして台帳(企業 60・人 25)を移したが、使いにくかった |
| 09-21 朝 | Twenty も自前の構想もやめ、Google スプレッドシート + GAS へ移る方針でリポジトリをアーカイブ |
| 09-21 | **方針を変え、あり物を使わず AI で自作する挑戦として再開。**画面のモックを作り、WSL2 の Docker + Cloudflare Tunnel + Access で公開 |

09-21 朝までの設計と Twenty の試用記録は、git の履歴(`21d044e` 以前)にある。
