# JOBS

作業を1枚で持つ。書式の正本は `questions-jobs` skill。問いは QUESTIONS.md へ。
**今動いているもの**: Twenty v2.41.0(`docker-compose.yml`・`https://twenty.sanei-clover.com`)。構成と運用の正は `docs/twenty.md`。本体(`docs/design/`)は設計のみでコードは無い。

## 次の一手

上から順にやる。ループはこの節の**先頭1件だけ**を取る。

- [ ] **J-015** エージェント(Claude Code / Codex)から Twenty へ繋ぎ直す(2026-09-21)
  - 由来: 2026-09-20 に公開ホスト名を `works` → `twenty.sanei-clover.com` へ変えた(J-014 の後、コミット `49a62d5`)。**claude.ai のカスタムコネクタ「Twenty SC」は旧 URL を持ったままなので今は繋がらない**
  - 人の作業: ①claude.ai の Settings → Connectors でコネクタの URL を `https://twenty.sanei-clover.com/mcp` に直す(または削除して登録し直す。OAuth の再認証が 1 回入る)②Twenty の Settings → API & Webhooks で API キーを作り、直下 `.env` の `TWENTY_API_KEY` に入れる(表示は一度きり)
  - そのあと: `claude mcp list` で `✔ Connected` を確認、Codex は `~/.codex/config.toml` に `[mcp_servers.twenty]`(手順は docs/twenty.md「エージェントからの MCP 接続」)、`tools/list` で疎通確認
  - 注意: コネクタ名を変えるとツール名の接頭辞(`mcp__claude_ai_<名前>__*`)も変わる。`claude -p --allowedTools` に書く名前は `claude mcp list` で確かめる
- [ ] **J-016** Twenty の拡張性調査(カスタムオブジェクト・カスタム項目・トリガー・独自画面・Apex 相当)を仕上げる(2026-09-21)
  - 由来: Q-032 の判断材料。2026-09-20 に `/deep-research` で走らせたが、**セッションの中断で 2 回止まり、統合(Synthesize)の直前で終わっている**
  - 途中結果は残っている: `~/.claude/projects/-home-takuya-workspace-perfect-crm/3b8a9456-.../subagents/workflows/wf_579ff615-a85/journal.jsonl`(150 件の agent 結果。検索・取得した主張・3 票の検証結果と根拠が入っている)。**`resumeFromRunId` は同一セッション内でしか効かない**ので、新セッションでは ①journal を読んで統合だけやる か ②`/deep-research` を同じ問いで流し直す
  - 結論は `docs/twenty.md` に節を作って書き、Q-032 に要点とポインタを残す。ライセンス(AGPL / エンタープライズ版)が「他社にも売る」に与える制約も含める
- [ ] **J-017** Twenty に残っている初期サンプルの後始末を決める(2026-09-21)
  - 由来: 2026-09-20 に企業 5・人物 5・商談 6 を削除したが(`f9dcf42`)、**ワークフロー 2 本が ACTIVE のまま**残っている(`Quick Lead` / `Create company when adding a new person`)。条件が合えば勝手にレコードを作る
  - 他に残っているもの: ダッシュボード `My First Dashboard`、タイトルの空のタスク 1 件。削除済みの 16 件はソフトデリート(ゴミ箱)で、完全に消すなら画面の Permanently destroy
  - 決めること: ワークフローを止める / 消す / 学習用に残す。消すなら MCP の `delete_one_*` を ID 指定で
- [ ] **J-018** スマホ実機で Twenty の PWA を確認する(2026-09-21)
  - 由来: Q-033 の①。`https://twenty.sanei-clover.com` をホーム画面に追加し、全画面(standalone)で開くか・日常のタスク操作が実用に足るかを見る
  - 調査済み: 公式ネイティブアプリは無い。`/manifest.json`(`display: standalone`)はあるが Service Worker が無いのでオフラインと Web Push は不可。iOS は `apple-mobile-web-app-capable` が無いので standalone になるか要確認(Q-033)
  - 結果を Q-033 に追記し、足りなければ TwentyMobile(サードパーティ)か自作の判断へ

**[2026-09-20] ここから下(J-001〜J-013)は Q-032(本体を作り続けるか Twenty に寄せるか)が決まるまで着手しない。**

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
  - 由来: Q-012・Q-014・Q-019。移行元の実構造と設計との差分は docs/design/05 §2・§3。切替(旧サービスの凍結)は含めない → J-010
  - 企業マスタが Notion に無いので、`企業名` テキストから名寄せして企業レコードを起こす。判断がつかないものは保留リストへ
  - 「活動の記録」の `振り返り／NEXT` は phone_number 型(Notion 側の設定ミス)。テキストとして読む
  - 案件とプロジェクトは分ける(Q-028)。`5-受注` 以降は 2 レコードに割る
  - 活動は CRM に関連するものだけ取り込む(Q-029)。日記・健康・読書のタグだけのページは移行しない
  - 画面より先に置く理由: MCP があれば UI 完成前に Claude Code から試せる
- [ ] **J-007** 画面 v1 を作る(2026-09-19)
  - 由来: Q-003・Q-016・Q-018。docs/design/06。一覧・詳細(タイムライン)・カンバン(軸を選べる)・今日・インボックス。キーボード操作(Q / J / K / E / C ほか)を最初から入れる。全画面レスポンシブ。参照は Attio / Linear
- [ ] **J-010** Notion・Todoist から perfect-crm へ切り替える(2026-09-19)
  - 由来: Q-012・Q-014。docs/design/05 §3 の切替条件(Q-018 の必須機能が動く、J-007 で閲覧できる、件数照合、切戻し手順)を満たしてから。J-006 と分けた理由: 必須機能が未決のまま旧サービスを凍結すると日常のタスク操作が途切れる
- [ ] **J-008** Cloudflare Tunnel で自社インスタンスを公開し、バックアップと復元を回す(2026-09-19)
  - 由来: Q-013。docs/design/04 §3・§4。復元を一度実演して runbook に書く
- [ ] **J-009** 2 人目の利用者が入る前に本番を常時稼働のホストへ移す(2026-09-19)
  - 由来: Q-013。docs/design/04 §8。トリガー: 2 人目の利用開始が決まったら。候補は社内の小型機か VPS、同じ Compose
- [ ] **J-011** Google ドライブ連携 v2 — ドキュメント / スプレッドシート / スライドの作成、既存ファイルのリンク、共有(2026-09-19)
  - 由来: Q-008・Q-025。docs/design/01 D-08、03 §7。v1(J-001〜J-010)の後
- [ ] **J-013** Web 会議の自動連携(2026-09-19)
  - 由来: Q-029・Q-030。会議から活動を起こす。Q-030 の結論待ち。v1 の後
- [ ] **J-012** Google コンタクト同期(CRM → Google の一方向)を実装する(2026-09-19)
  - 由来: Q-020。組織設定で ON にしたときだけ `contacts` scope を要求する。既定 OFF。v1 の後

## 完了

新しいものを上に。消さない(履歴はここに残る)。

- [x] ~~**J-014** sanei-clover.com を操作できる Cloudflare API トークンを発行し、移行で壊れた DNS レコードを直す(2026-09-19)~~ → 完了(2026-09-19): トークン設置、autodiscover・apex・www のプロキシ OFF、_dmarc 追加、works.sanei-clover.com の Tunnel + Access 構築。権限を絞らない判断と前提は docs/twenty.md(contacts と NocoDB は 2026-09-20 に撤去)
