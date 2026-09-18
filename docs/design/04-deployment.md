# 04 配置と運用

## 1. Compose

| サービス | イメージ | 役割 |
|---|---|---|
| `app` | 自前(Node LTS)。API・MCP・静的 UI を 1 プロセスで | 無状態 |
| `postgres` | `postgres:18` | 状態のすべて。`pg_trgm` は同梱(`CREATE EXTENSION`) |
| `cloudflared` | `cloudflare/cloudflared` | Tunnel。受信ポートを開けない |
| `minio`(任意) | S3 互換 | 添付が要るようになったら。クラウドでは R2 / S3 に差し替え |

- 設定は環境変数(`.env`、git 管理外)
- `docker compose up` で立つ。初回はマイグレーションと管理者の払い出しを `app` の起動時に行う

## 2. 開発と本番を同じ Surface で

- Compose プロジェクト名で分ける: `-p perfect-crm`(本番)/ `-p perfect-crm-dev`(開発)。ポート・ボリューム・`.env` を別にする
- 本番のイメージはタグ固定。開発はソースをマウント

## 3. 公開経路

- Cloudflare Tunnel: `crm.<ドメイン>` → `app:3000`。DNS は Cloudflare(共通ルール)。固定 IP・ポート開放が不要なので、NAT の内側のノートPCでも成り立つ
- Cloudflare Access: 自社インスタンスの UI に置く。アプリ自身の認証が本命なので、二重ログインの摩擦が気になれば外す
- Access を bypass するパス: `/mcp`(エージェントは Access のログイン画面を通れない)、`/webhooks/*`(v2)
- SaaS では Access を使わない(顧客が通れない)。アプリ認証のみ

## 4. バックアップと復元

- 夜間 `pg_dump` → Cloudflare R2(または S3)。30 日分
- 復元手順を一度実演して `docs/runbook/` に書く(J-008)
- WSL2 の仮想ディスクごと消える事故を前提にする

## 5. 引っ越し

Compose が動く場所ならどこでも。①移設先で `docker compose up` ②`pg_dump` / `pg_restore` ③`.env` を移す ④Tunnel の向き先を変える。DNS は触らない。

## 6. SaaS モード

| | セルフホスト | SaaS |
|---|---|---|
| 組織 | 1 つ。起動時に seed | 複数。自己登録+招待 |
| `MODE` | `single` | `multi` |
| 登録 | 招待のみ | 開放 |
| 課金 | 無し | v3 |
| Access | 任意 | 無し |

コードは同じ。`MODE` で登録フローと初期化が変わるだけ。

## 7. Google OAuth クライアント

| 配布 | OAuth クライアント | 審査 |
|---|---|---|
| 自社 | 自社 Workspace の Internal 種別 | 不要 |
| SaaS | 自分の 1 クライアント(External) | `gmail.send`(sensitive)の審査。restricted が無ければ CASA 不要の見込み(Q-022) |
| セルフホスト顧客 | 顧客が自分の Google Cloud で作り `.env` に設定 | 顧客側。redirect URI が顧客ごとに違うため共用できない |

顧客の Workspace 管理者が外部アプリを制限している場合は許可が要る。導入手順に書く。

## 8. 稼働の前提

- 利用者 1 名の間: Surface。スリープ・Windows Update・WSL2 再起動で止まってよい。Tunnel は経路を解くが稼働率は解かない
- 2 人目の前: 常時稼働のホストへ本番を移す(J-009)。候補は社内の小型機、または VPS。同じ Compose
