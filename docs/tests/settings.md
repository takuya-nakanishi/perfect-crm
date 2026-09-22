# 環境設定と連携(SET)テストケース表

読み方・資産の書き方・`—` の扱いは [`README.md`](README.md)。仕様は `docs/design/03` §5、`04` §8・§10、`05` §11、`06` §7、棚卸し `08` §1(1・6・7)。

**段階**: `管理者`(誰が変えられるか)、`MCP`、`フォーム`(Web フォームの受け口)、`ドライブ`(Google ドライブの項目)、`サイドバー`(テーブルの表示)。
この領域は**優先順位の 6 位**(外からの書き込みの安全弁)。

L2 の対象は `frontend/src/mocks/settings.ts`・`drive.ts`・`mockClient.ts`(`requireAdmin`)。

## 1. 管理者

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 |
|---|---|---|---|---|---|---|
| SET-001 | 利用者 | 管理者 | 権限 | L3 | 管理者でない利用者: 環境設定がサイドバーに出ず、`/settings/mcp` を直接開いてもホームへ戻る | `smoke.mjs「管理者でない人は環境設定に入れない(サイドバーにも出ない)」` |
| SET-002 | 利用者 | 管理者 | 権限 | L2 | 管理者でない利用者: `createObject` / `updateObject` / `deleteObject` / `reorderObjects` → 403 | `mockClient.test.ts` |
| SET-003 | 利用者 | 管理者 | 権限 | L2 | 管理者でない利用者: `listMcpTokens` / `createMcpToken` / `listWebForms` / `createWebForm` → 403 | `mockClient.test.ts` |
| SET-004 | 利用者 | 管理者 | 権限 | L2 | 管理者でない利用者: `createView` / `updateView` / `deleteView` → 通る(ビューは誰でも。Q-045) | `mockClient.test.ts` |
| SET-005 | システム | 管理者 | 権限 | L2 | 未ログイン: `getMeta` / `listRecords` → 401 | `mockClient.test.ts` |

## 2. MCP

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 |
|---|---|---|---|---|---|---|
| SET-020 | 管理者 | MCP | 証跡 | L3 | 管理者: トークンを発行 → 全文が 1 回見え、繋ぎ方の設定に入る。失効できる | `smoke.mjs「トークンを発行すると全文が 1 回見えて、繋ぎ方の設定に入る」` / `smoke.mjs「トークンを失効できる」` |
| SET-021 | 管理者 | MCP | 安全弁 | L2 | `createMcpToken`: `secret` は `wks_` + 40 文字、`token.prefix` はその先頭 8 文字。一覧には `secret` が入らない | `mockClient.test.ts` |
| SET-022 | 管理者 | MCP | 整合 | L2 | `createMcpToken` の名前が空 → 400。`revokeMcpToken` で消え、無い id → 404 | `mockClient.test.ts` |
| SET-023 | 管理者 | MCP | 整合 | L2 | `createMcpToken` の `created_by` は自分、`last_used_at` は null | `mockClient.test.ts` |
| SET-024 | 外部 | MCP | 権限 | L5 | AI アプリ(Claude Code): Access のサービストークン + アプリのトークンをヘッダで渡して `/mcp` へ → 門を通り、その利用者として読める(J-028 のあと) | — |

## 3. Web フォーム

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 |
|---|---|---|---|---|---|---|
| SET-040 | 管理者 | フォーム | 整合 | L3 | 管理者: フォームを作る → 受け口と、Access のサービストークン付きで送る例、埋め込み用の HTML が出る | `smoke.mjs「フォームを作ると、受け口と、Access のサービストークン付きで送る例が出る」` / `smoke.mjs「埋め込み用の HTML も出る」` |
| SET-041 | 外部 | フォーム | 整合 | L3 | 管理者: テスト送信 → 受け口からレコードができ、トーストの「開く」で見られる | `smoke.mjs「テスト送信で、受け口からレコードができる」` |
| SET-042 | 管理者 | フォーム | 整合 | L2 | `createWebForm`: 名前が空 / テーブルが無い / 項目が 0 / readonly・関連先・ドライブの項目 / `redirect_url` が http(s) でない → それぞれ 400 | `mockClient.test.ts` |
| SET-043 | 外部 | フォーム | 整合 | L2 | `submitWebForm`: `fields` に無い列は捨て、`defaults` を足し、レコードができる。`submissions` が増え `last_submitted_at` が入る | `mockClient.test.ts` |
| SET-044 | 外部 | フォーム | 整合 | L2 | `submitWebForm`: form-urlencoded の文字(数値 `"1200000"`、日付 `2026/9/30`、選択肢のラベル)を項目の型に直してから作る。直せなければ 400 | `mockClient.test.ts` |
| SET-045 | 外部 | フォーム | 安全弁 | L2 | `submitWebForm`: `enabled: false` → 404。無い鍵 → 404。先のテーブルが削除中 → 404 | `mockClient.test.ts` |
| SET-046 | 外部 | フォーム | 安全弁 | L2 | `submitWebForm`: `_gotcha` が埋まっている(bot)→ 例外を投げず 200 相当で返るが、レコードは増えず `submissions` も増えない(応答の `record` は `id` だけの空。04 §10 の 3)。`_gotcha` が空なら通る(対照) | — |
| SET-047 | 管理者 | フォーム | 安全弁 | L2 | `rotateWebFormKey` → 鍵が変わり、古い鍵で送ると 404 | `mockClient.test.ts` |
| SET-048 | 外部 | フォーム | 整合 | L2 | `submitWebForm` で作ったレコードの担当(user 型)は空(`defaults` で入れられる) | `mockClient.test.ts` |

## 4. Google ドライブ

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 |
|---|---|---|---|---|---|---|
| SET-060 | 利用者 | ドライブ | 整合 | L3 | 利用者: 「新規」→ レコード名の Google ドキュメントが付く。「参照」で複数のファイルを付け、外したものは外れたまま | `smoke.mjs「「新規」でレコード名の Google ドキュメントが付く」` / `smoke.mjs「「参照」で複数のファイルを付けられる」` / `smoke.mjs「外したものは外れたまま残る(再読み込み後)」` |
| SET-061 | 利用者 | ドライブ | 整合 | L2 | `createDocument`: ドキュメントの名前はレコードの表示名、MIME はドキュメント、項目の末尾に足される。作ったものは `listFiles` で見つかる | — |
| SET-062 | 利用者 | ドライブ | 整合 | L2 | `createDocument`: ドライブ型でない項目 → 400。無いレコード → 404 | — |
| SET-063 | 利用者 | ドライブ | 表記 | L2 | `listFiles("テンプレ")`: 名前の部分一致(正規化)。空なら全部、20 件まで | — |

## 5. サイドバー

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 |
|---|---|---|---|---|---|---|
| SET-080 | 管理者 | サイドバー | 整合 | L3 | 管理者: 活動は初めからサイドバーに出ない。スイッチで出せる | `smoke.mjs「活動は初めからサイドバーに出ない」` / `smoke.mjs「スイッチで活動をサイドバーに出せる」` |
