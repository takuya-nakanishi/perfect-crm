# 環境設定と連携(SET)テストケース表

読み方・資産の書き方・`—` の扱いは [`README.md`](README.md)。仕様は `docs/design/03` §5、`04` §8・§10・§14、`05` §11、`06` §7、棚卸し `08` §1(1・6・7)。ワークフロー(Slack に知らせる本体)は [`workflows.md`](workflows.md)。

**段階**: `管理者`(誰が変えられるか)、`MCP`、`フォーム`(Web フォームの受け口)、`ドライブ`(Google ドライブの項目)、`サイドバー`(テーブルの表示)、`Slack`(ワークフローが知らせる先のチャンネル)。
この領域は**優先順位の 6 位**(外からの書き込みの安全弁)。

L2 の対象は `frontend/src/mocks/settings.ts`・`drive.ts`・`mockClient.ts`(`requireAdmin`)。

## 1. 管理者

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 | API の資産 |
|---|---|---|---|---|---|---|---|
| SET-001 | 利用者 | 管理者 | 権限 | L3 | 管理者でない利用者: 環境設定がサイドバーに出ず、`/settings/mcp` を直接開いてもホームへ戻る | `smoke.mjs「管理者でない人は環境設定に入れない(サイドバーにも出ない)」` | — |
| SET-002 | 利用者 | 管理者 | 権限 | L2 | 管理者でない利用者: `createObject` / `updateObject` / `deleteObject` / `saveSidebar`(並べ替えもフォルダも)→ 403 | `mockClient.test.ts` | — |
| SET-003 | 利用者 | 管理者 | 権限 | L2 | 管理者でない利用者: `listMcpTokens` / `createMcpToken` / `listWebForms` / `createWebForm` → 403 | `mockClient.test.ts` | — |
| SET-004 | 利用者 | 管理者 | 権限 | L2 | 管理者でない利用者: `createView` / `updateView` / `deleteView` → 通る(ビューは誰でも。Q-045) | `mockClient.test.ts` | — |
| SET-005 | システム | 管理者 | 権限 | L2 | 未ログイン: `getMeta` / `listRecords` → 401 | `mockClient.test.ts` | — |

## 2. MCP

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 | API の資産 |
|---|---|---|---|---|---|---|---|
| SET-020 | 管理者 | MCP | 証跡 | L3 | 管理者: トークンを発行 → 全文が 1 回見え、繋ぎ方の設定に入る。失効できる | `smoke.mjs「トークンを発行すると全文が 1 回見えて、繋ぎ方の設定に入る」` / `smoke.mjs「トークンを失効できる」` | — |
| SET-021 | 管理者 | MCP | 安全弁 | L2 | `createMcpToken`: `secret` は `wks_` + 40 文字、`token.prefix` はその先頭 8 文字。一覧には `secret` が入らない | `mockClient.test.ts` | — |
| SET-022 | 管理者 | MCP | 整合 | L2 | `createMcpToken` の名前が空 → 400。`revokeMcpToken` で消え、無い id → 404 | `mockClient.test.ts` | — |
| SET-023 | 管理者 | MCP | 整合 | L2 | `createMcpToken` の `created_by` は自分、`last_used_at` は null | `mockClient.test.ts` | — |
| SET-024 | 外部 | MCP | 権限 | L5 | AI アプリ(Codex・Claude Code): 環境設定で発行したトークンだけをヘッダで渡して公開 URL の `/mcp` へ → その利用者として読める(門が無いので、ほかのヘッダは要らない) | — | — |
| SET-025 | 管理者 | MCP | 権限 | L3 | 利用者: Claude から来た依頼の許可の画面で「許可する」→ 環境設定の「接続中のアプリ」に出て、切れる | `smoke.mjs「Claude からの接続を許可すると、接続中のアプリに出る」` / `smoke.mjs「接続を切れる」`(モックだけ。本物の流れは `test_mcp.py`) | — |
| SET-026 | 外部 | MCP | 安全弁 | L3 | 利用者: 無い・期限切れの依頼で許可の画面を開く → 理由が出て、許可のボタンは出ない | `smoke.mjs「無い(期限切れの)依頼では、許可の画面が理由を出す」` | — |
| SET-027 | 外部 | MCP | 権限 | L4 | Claude(カスタムコネクタ): 登録 → /authorize → 本人が許可 → /token(PKCE)→ /mcp で読み書き → refresh で新しい組、古い refresh は invalid_grant → 接続を切ると 401。Claude 以外の戻り先は登録できない。環境設定のトークン(`wks_`)でも /mcp に入れる | `test_mcp.py`(pytest) | — |
| SET-028 | 外部 | MCP | 権限 | L5 | Claude.ai にカスタムコネクタを足して許可 → スマホの Claude から「今日のタスクは?」で Works のタスクが返る(公開 URL を含む) | — | — |
| SET-029 | 外部 | MCP | 頑健性 | L4 | だれでも叩ける口がためる行に上限がある: 許可の無い登録は新しいものから 50 件だけ残し(古いものから消す。断らない)、許可の付いた登録は消さない。許可を待つ依頼も 50 件まで(消えた依頼の許可の画面は 404) | `test_mcp.py`(pytest) | — |

## 3. Web フォーム

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 | API の資産 |
|---|---|---|---|---|---|---|---|
| SET-040 | 管理者 | フォーム | 整合 | L3 | 管理者: フォームを作る → 受け口と、サーバから送る例(門のヘッダは無い)、埋め込み用の HTML が出る | `smoke.mjs「フォームを作ると、受け口と、サーバから送る例が出る」` / `smoke.mjs「埋め込み用の HTML も出る」` | — |
| SET-041 | 外部 | フォーム | 整合 | L3 | 管理者: テスト送信 → 受け口からレコードができ、トーストの「開く」で見られる | `smoke.mjs「テスト送信で、受け口からレコードができる」` | — |
| SET-042 | 管理者 | フォーム | 整合 | L2 | `createWebForm`: 名前が空 / テーブルが無い / 項目が 0 / readonly・関連先・ドライブの項目 / `redirect_url` が http(s) でない → それぞれ 400 | `mockClient.test.ts` | — |
| SET-043 | 外部 | フォーム | 整合 | L2 | `submitWebForm`: `fields` に無い列は捨て、`defaults` を足し、レコードができる。`submissions` が増え `last_submitted_at` が入る | `mockClient.test.ts` | — |
| SET-044 | 外部 | フォーム | 整合 | L2 | `submitWebForm`: form-urlencoded の文字(数値 `"1200000"`、日付 `2026/9/30`、選択肢のラベル)を項目の型に直してから作る。直せなければ 400 | `mockClient.test.ts` | — |
| SET-045 | 外部 | フォーム | 安全弁 | L2 | `submitWebForm`: `enabled: false` → 404。無い鍵 → 404。先のテーブルが削除中 → 404 | `mockClient.test.ts` | — |
| SET-046 | 外部 | フォーム | 安全弁 | L2 | `submitWebForm`: `_gotcha` が埋まっている(bot)→ 例外を投げず 200 相当で返るが、レコードは増えず `submissions` も増えない(応答の `record` は `id` だけの空。04 §10 の 3)。`_gotcha` が空なら通る(対照) | `mockClient.test.ts` | — |
| SET-047 | 管理者 | フォーム | 安全弁 | L2 | `rotateWebFormKey` → 鍵が変わり、古い鍵で送ると 404 | `mockClient.test.ts` | — |
| SET-048 | 外部 | フォーム | 整合 | L2 | `submitWebForm` で作ったレコードの担当(user 型)は空(`defaults` で入れられる) | `mockClient.test.ts` | — |
| SET-049 | 外部 | フォーム | 安全弁 | L4 | 受け口の間引きは、受け口ごと・送り元(Cloudflare が付ける IP)ごとに 1 分 10 件。11 件目は 429、ほかの送り元からは受ける(手前の Caddy の IP で数えると、訪問者全員が 1 人に見える) | `test_settings.py`(pytest) | — |

## 4. Google ドライブ

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 | API の資産 |
|---|---|---|---|---|---|---|---|
| SET-060 | 利用者 | ドライブ | 整合 | L3 | 利用者: 「新規」→ レコード名の Google ドキュメントが付く。「参照」で複数のファイルを付け、外したものは外れたまま | `smoke.mjs「「新規」でレコード名の Google ドキュメントが付く」` / `smoke.mjs「「参照」で複数のファイルを付けられる」` / `smoke.mjs「外したものは外れたまま残る(再読み込み後)」` | — |
| SET-064 | 利用者 | ドライブ | 整合 | L3 | 繋いでいない利用者: ドライブの項目に「Google に接続」が出て、「新規」「参照」は出ない(04 §8) | `smoke.mjs「繋いでいないと「新規」「参照」の代わりに「Google に接続」が出る」` | — |
| SET-065 | 利用者 | ドライブ | 整合 | L3 | 管理者が Google の OAuth クライアントを入れていない(http): ドライブの項目に「Google 連携が設定されていません」が出て、「新規」「参照」は出ない(04 §8) | `smoke.mjs「Google 連携が未設定なら、その旨が出て「新規」「参照」は出ない」`(http のときだけ走る) | — |
| SET-061 | 利用者 | ドライブ | 整合 | L2 | `createDocument`: ドキュメントの名前はレコードの表示名、MIME はドキュメント、項目の末尾に足される。作ったものは `listFiles` で見つかる | `mockClient.test.ts` | `test_google.py` |
| SET-062 | 利用者 | ドライブ | 整合 | L2 | `createDocument`: ドライブ型でない項目 → 400。無いレコード → 404 | `mockClient.test.ts` | `test_google.py` |
| SET-063 | 利用者 | ドライブ | 表記 | L2 | `listFiles("テンプレ")`: 名前の部分一致(正規化)。空なら全部、20 件まで | `mockClient.test.ts` | `test_google.py` |

## 5. サイドバー

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 | API の資産 |
|---|---|---|---|---|---|---|---|
| SET-080 | 管理者 | サイドバー | 整合 | L3 | 管理者: 活動は初めからサイドバーに出ない。スイッチで出せる | `smoke.mjs「活動は初めからサイドバーに出ない」` / `smoke.mjs「スイッチで活動をサイドバーに出せる」` | — |

## 6. Slack のチャンネル

L2 は `mocks/slack.ts` の擬似(Slack の許可の画面は無く、「繋ぐ」で架空のチャンネルを 1 つ足したことにする)。
本物の Slack との往復(認可コードの交換・Webhook への投稿・失敗の分類)は `test_slack.py` が偽物の Slack で確かめる。
2026-09-30 に 1 つから複数のチャンネルへ替えた(SET-100〜102・104・105 は、そのときに書き直した)。何をいつ知らせるかはワークフロー(`workflows.md`)。

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 | API の資産 |
|---|---|---|---|---|---|---|---|
| SET-100 | 管理者 | Slack | 整合 | L2 | 初めは空。`slackConnect` → チャンネル(と繋いだ人)が並び、もう一度で 2 つめ。同じチャンネルを繋ぎ直すと行は増えず(id も同じ)、名前と Webhook が新しくなる。`slackDisconnect(id)` → 消える(本物は Works が Webhook を捨てるだけで、Slack のアプリは外さない。`apps.uninstall` を呼んだら落ちる) | `mockClient.test.ts` | `test_slack.py` |
| SET-101 | 利用者 | Slack | 権限 | L2 | 管理者でない利用者: `slackStatus` / `slackConnect` / `slackTest` / `slackDisconnect` → 403。チャンネルは変わらない | `mockClient.test.ts` | `test_slack.py` |
| SET-102 | 管理者 | Slack | 証跡 | L2 | `slackTest(id)`: 無いチャンネル(UUID でない id も)→ 404。あれば最終送信の時刻が入り、失敗は空。送れなければ理由が残り、投稿先が消えた類なら「要再接続」。送れたら消える(失敗の再現は API の資産だけ) | `mockClient.test.ts` | `test_slack.py` |
| SET-103 | 外部 | Slack | 整合 | L2 | `submitWebForm`: 「どこから」に Web フォームを入れたワークフローがあれば知らせる(実行記録が済みになり、チャンネルの最終送信が進む)。bot(`_gotcha`)はレコードを作らないので知らせない。ワークフローが無ければ何も送らない | `mockClient.test.ts` | `test_workflows.py` |
| SET-104 | 管理者 | Slack | 整合 | L3 | 管理者: 「チャンネルを追加」→ 戻ってくると選んだチャンネルが並ぶ。テスト通知 → 最終送信の時刻。ワークフローが送っているチャンネルは外せず、使っていないものは外せる | `smoke.mjs「チャンネルを追加すると、選んだチャンネルが並ぶ」` / `smoke.mjs「テスト通知を送ると、最終送信の時刻が出る」` / `smoke.mjs「ワークフローが送っているチャンネルは外せず、理由が出る」` / `smoke.mjs「使っていないチャンネルは外せる」`(モックだけ) | — |
| SET-105 | 管理者 | Slack | 整合 | L3 | 管理者が Slack アプリの資格情報を入れていない(http): Slack の節に「資格情報が入っていません」が出て、「チャンネルを追加」は出ない。入れていれば出る | `smoke.mjs「Slack アプリが未設定なら、その旨が出て「チャンネルを追加」は出ない」` / `smoke.mjs「Slack アプリが設定済みなら「チャンネルを追加」が出る」`(http のときだけ走る) | — |
| SET-106 | 外部 | Slack | 安全弁 | L5 | 本番: 自社の Slack でチャンネルを繋ぐ → テスト通知と、ワークフロー(Web フォームから)の通知がチャンネルに届く。本文に書いた `<!channel>` は効かず、そのまま文字で出る | — | — |
| SET-107 | 管理者 | Slack | 安全弁 | L2 | `slackDisconnect(id)`: ワークフローが送り先に選んでいれば 409 `channel_in_use`(メッセージにワークフローの名前)。そのワークフローを削除すれば(削除中は数えない)外せる | `mockClient.test.ts` | `test_slack.py` |
| SET-108 | 管理者 | Slack | 安全弁 | L2 | `slackConnect(returnTo)`: 許可のあとは頼んだ画面(環境設定の中)へ戻す。外の URL・`//…`・環境設定の外のパス・`..` を含むものは、環境設定の Slack へ差し替える(開いたリダイレクトにしない) | `mockClient.test.ts` | `test_slack.py` |
