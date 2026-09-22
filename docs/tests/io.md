# 入出力と評価(IO)テストケース表

読み方・資産の書き方・`—` の扱いは [`README.md`](README.md)。仕様は `docs/design/04` §3〜§5・§7、`02` §2、`05` §3、棚卸し `08` §2。

**段階**: `条件`(フィルタの評価)、`並び`、`集計`、`検索`、`日付`(マクロと表記)、`CSV`、`書式`、`洗浄`(richtext)、`繰り返し`(規則)。
この領域は**優先順位の 2 位**。ここで決めた意味が、将来の SQL(J-021・J-024)の受け入れ条件になる。

L1 の対象は `frontend/src/lib/`(`filter.ts`・`dates.ts`・`quickAddParser.ts`・`format.ts`・`richtext.ts`・`recurrence.ts`・`drive.ts`)。L2 は `frontend/src/mocks/`(`engine.ts` の `query` / `aggregate` / `searchAll`、`csv.ts`)。

## 1. 条件(`lib/filter.ts`)

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 |
|---|---|---|---|---|---|---|
| IO-001 | システム | 条件 | 整合 | L1 | `ne` は NULL を含む(空も「違う」)。値が同じなら偽 | `filter.test.ts` |
| IO-002 | システム | 条件 | 整合 | L1 | `eq` と `lt`〜`gte` は NULL に対して偽 | `filter.test.ts` |
| IO-003 | システム | 条件 | 整合 | L1 | `$today` / `$today+7` / `$start_of_month` は文脈の今日を基準に解決する | `filter.test.ts` |
| IO-004 | システム | 条件 | 整合 | L1 | `in` は配列のどれかと一致、`not_in` はどれとも一致しない(NULL は `not_in` で真) | `filter.test.ts` |
| IO-005 | システム | 条件 | 表記 | L1 | `contains` は大文字小文字を区別しない。文字でない列には偽 | `filter.test.ts` |
| IO-006 | システム | 条件 | 整合 | L1 | `is_empty` は NULL・空文字・`[]`(複数選択の空)で真、`is_not_empty` はその逆 | `filter.test.ts` |
| IO-007 | システム | 条件 | 整合 | L1 | 日時の列(ISO)を日付(`YYYY-MM-DD`)と比べる → 文脈の時刻帯(`ctx.timezone`。ワークスペースの設定)での日付に直してから比べる。UTC 23:30 の完了は `Asia/Tokyo` では翌日、`UTC` では当日(端末の時刻帯に依らない) | `filter.test.ts` |
| IO-008 | システム | 条件 | 整合 | L1 | `$me` は文脈の利用者 ID。`$today-30` は 30 日前。`$end_of_month` は月末 | `filter.test.ts` |
| IO-009 | システム | 条件 | 整合 | L1 | 複数選択の列(JSON の配列): `in` / `eq` は「どれかを含む」、`not_in` / `ne` は「どれも含まない」。壊れた JSON は配列と見なさない | `filter.test.ts` |
| IO-010 | システム | 条件 | 整合 | L1 | `and` の中の `or`(お気に入りの「今日」: 期限が今日以前 または 期限が空)を正しく評価する。空の `and` は真 | `filter.test.ts` |
| IO-011 | システム | 並び | 整合 | L1 | `makeComparator`: NULL は昇順でも降順でも末尾。文字は文字順、数値は数値順。2 つめのキーで同点を割る | `filter.test.ts` |

## 2. 並び・集計・検索(`mocks/engine.ts`)

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 |
|---|---|---|---|---|---|---|
| IO-020 | システム | 並び | 整合 | L2 | `query` を選択肢の列で並べる → 定義順(P1 → P4、見込み → 失注)。文字順ではない | `engine.test.ts` |
| IO-021 | システム | 並び | 整合 | L2 | `query` を参照・利用者の列で並べる → 参照先の表示名の順 | `engine.test.ts` |
| IO-022 | システム | 並び | 整合 | L2 | `query` に `limit: 0` → `records` は空で `total` は件数。`offset` で続きが取れる | `engine.test.ts` |
| IO-023 | システム | 検索 | 表記 | L2 | `query` の `q`: ひらがなで打ってもカタカナの名前に当たる。全角半角・大文字小文字も区別しない | `engine.test.ts` |
| IO-024 | システム | 検索 | 整合 | L2 | `query` の `q` は文字の列だけを見る。richtext は書式(タグ)を落とした文字で当てる(`<strong>` の中の語も当たる) | `engine.test.ts` |
| IO-025 | システム | 検索 | 整合 | L2 | `query` の `references` に、参照・利用者・関連先(polymorphic)の表示名が、必要な ID の分だけ入る | `engine.test.ts` |
| IO-026 | システム | 検索 | 整合 | L2 | `searchAll`: 名前に当たったレコードが先。1 テーブル 6 件まで。サイドバーに出していないテーブル(活動)も対象 | `engine.test.ts` |
| IO-027 | システム | 集計 | 整合 | L2 | `aggregate`: `count` は条件に合う全行数(値が空でも数える)。`sum` / `avg` は値が数値の行だけ(数値の行が 0 件なら 0)。`weight_field` は値 × 百分率 / 100 を足す | `engine.test.ts` |
| IO-028 | システム | 集計 | 整合 | L2 | `aggregate` の `group_by` が選択肢 → 定義順。`order: value_desc` → 値の大きい順。値が空のグループは `key: null`・「未設定」で末尾 | `engine.test.ts` |
| IO-029 | システム | 集計 | 整合 | L2 | `aggregate` の `bucket: month` + `range` → 範囲内の月を全部、空の月も 0 で返す。ラベルは区間の先頭と 1 月だけ年付き(`2026年8月`・`9月`・年をまたげば `2027年1月`) | `engine.test.ts` |
| IO-030 | システム | 集計 | 整合 | L2 | `aggregate` を関連先のテーブル名の列(`related_object`)で分ける → ラベルはテーブルの表示名、空は「関連先なし」 | `engine.test.ts` |

## 3. 日付と読み取り(`lib/dates.ts`・`lib/quickAddParser.ts`)

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 |
|---|---|---|---|---|---|---|
| IO-040 | 利用者 | 日付 | 表記 | L1 | `formatDue`: 今日 / 明日 / 昨日 / 6 日以内は「金曜日」/ それ以外は「9月30日(水)」/ 年が違えば「2027年1月10日(日)」 | `dates.test.ts` |
| IO-041 | 利用者 | 日付 | 表記 | L1 | `formatDateTime`: 今日は「今日 9:05」、昨日は「昨日 …」、同じ年は「9月20日」、違う年は `2025/12/01` | `dates.test.ts` |
| IO-042 | 利用者 | 日付 | 整合 | L1 | `parseQuickAdd`: 「見積を送る 明日 p1」→ 件名「見積を送る」・期限は明日・P1。「今日の議事録を送る」の「今日」は件名に残る | `quickAddParser.test.ts` |
| IO-043 | 利用者 | 日付 | 整合 | L1 | `parseQuickAdd`: 「来週火曜」は次の月曜から始まる週の火曜、「金曜」は次の金曜(今日が金曜なら 7 日後)、「月末」「来月」「3日後」「9/30」「30日」(過ぎていれば来月) | `quickAddParser.test.ts` |
| IO-044 | 利用者 | 日付 | 整合 | L1 | `parseQuickAdd`: 「毎週」→ `repeat: weekly`、期限が無ければ今日。「平日」「隔週」「毎月」も。2 つめの繰り返しの語は件名に残る | `quickAddParser.test.ts` |
| IO-045 | 利用者 | 日付 | 表記 | L1 | `parseQuickAdd`: 全角の「ｐ１」や「９／３０」も読む(NFKC) | `quickAddParser.test.ts` |
| IO-046 | システム | 日付 | 整合 | L1 | `resolveDateMacro`: `$today+N` / `$today-N` / `$start_of_month` / `$end_of_month`。知らないマクロは null | `dates.test.ts` |
| IO-047 | システム | 日付 | 整合 | L1 | `addMonths`(区間の計算用): 日を 1 日に固定して月を進める(`2026-01-31` + 1 → `2026-02-01`、12 月 + 1 → 翌年 1 月)。日を保つ計算は `nextDue`(IO-085)の側 | `dates.test.ts` |

## 4. CSV(`mocks/csv.ts`)

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 |
|---|---|---|---|---|---|---|
| IO-060 | 外部 | CSV | 頑健性 | L1 | `parseCsv`: 引用符の中の改行と `""`、先頭の BOM、CRLF を扱う。空行は捨てる | `csv.test.ts` |
| IO-061 | 外部 | CSV | 頑健性 | L1 | `parseCsv`: 1 行目にカンマが無くタブがあればタブ区切り(表計算からの貼り付け) | `csv.test.ts` |
| IO-062 | 外部 | CSV | 整合 | L2 | `importCsv` の `mapping` 省略 → 見出しを項目名(正規化して比較)と列名から推測。同じ項目に 2 列は当てない(先の列が勝つ) | `csv.test.ts` |
| IO-063 | 外部 | CSV | 整合 | L2 | `importCsv`: 読めない行(必須が空・無い選択肢・数値でない)は `errors` に行番号と理由を残して飛ばし、読める行だけ作る。`dry_run` は作らない | `csv.test.ts` |
| IO-064 | 外部 | CSV | 整合 | L2 | `coerce`: 数値は全角・カンマ・円記号を受ける。日付は `2026/9/30`・`2026年9月30日` も。選択肢はラベルでも値でも。利用者は名前かメール。チェックは「はい / true / 1 / ○」 | `csv.test.ts` |
| IO-065 | 外部 | CSV | 安全弁 | L2 | `coerce` の参照: 表示名が一致するレコードが 1 件なら結ぶ。**同名が 2 件以上ならエラー**(黙って選ばない)。UUID ならそのまま | `csv.test.ts` |
| IO-066 | 外部 | CSV | 整合 | L2 | `coerce` の複数選択: 「営業、事務」を配列に。無いラベルはエラー。重複は 1 つ | `csv.test.ts` |
| IO-067 | 外部 | CSV | 整合 | L2 | `importCsv` の `created_ids` は CSV の並びと同じ順(一覧で上から同じ順に見える) | `csv.test.ts` |
| IO-068 | 利用者 | CSV | 表記 | L2 | `exportCsv`: 先頭に BOM、見出しは項目名、選択肢はラベル、参照と利用者は表示名、複数選択は「営業、事務」、richtext は書式を落とした文字、ドライブは名前と URL | `csv.test.ts` |
| IO-069 | 利用者 | CSV | 整合 | L2 | `importCsv`: `readonly`・関連先(polymorphic)・ドライブの列は受け付けない(mapping に当てても null) | `csv.test.ts` |
| IO-070 | 利用者 | CSV | 整合 | L3 | 利用者: 歯車 → エクスポート → `見積_YYYY-MM-DD.csv` が落ちる | `smoke.mjs「エクスポートで CSV が落ちる」` |
| IO-071 | 利用者 | CSV | 整合 | L3 | 利用者: インポートで 3 行のうち 1 行が無い選択肢 → 読める 2 行だけ取り込む | `smoke.mjs「インポートは、読める行だけを取り込む」` |

## 5. 書式・洗浄・繰り返し(`lib/format.ts`・`lib/richtext.ts`・`lib/recurrence.ts`・`lib/drive.ts`)

| ID | 視点 | 段階 | 性質 | 層 | ケース | 対応する資産 |
|---|---|---|---|---|---|---|
| IO-080 | 利用者 | 書式 | 表記 | L1 | `formatYen`: `¥1,200,000`(半角の ¥)。`formatYenCompact`: 1.2億円 / 1,240万円 / ¥9,800 | — |
| IO-081 | 利用者 | 書式 | 表記 | L1 | `formatNumber`: `scale` 無しは整数に丸める(12.54 → `13`)、`scale: 2` は `12.54`、`scale: 0` は `13`。`formatPercent`: 無しは最大 1 桁(`12.5%`)、`scale: 2` は `12.54%`、**`scale: 0` は `13%`(0 を無視しない)** | — |
| IO-082 | システム | 洗浄 | 安全弁 | L1 | `sanitizeHtml`: `<script>`・`onclick`・`<img>` を落とし、`<div>`/`<span>` は中身だけ残す。`javascript:` の `href` は落とし、`https:` は `target=_blank rel=noreferrer` を付ける | — |
| IO-083 | システム | 洗浄 | 整合 | L1 | `sanitizeHtml`: 言及 `<span data-type="mention" data-id="accounts:<uuid>" data-label="…">` は `role=link` 付きで残す。`data-id` が規則外なら中身の文字だけ残す | — |
| IO-084 | システム | 洗浄 | 整合 | L1 | `extractMentions`: 二重引用符でも単引用符でも、同じ ID は 1 回。`plainText` は段落・改行を落として `@名前` を残す。`isEmptyHtml` は `<p></p>` を空とみなす | — |
| IO-085 | 利用者 | 繰り返し | 整合 | L1 | `nextDue`: 毎日 +1、平日は土日を飛ばす(金曜 → 月曜)、毎週 +7、隔週 +14、毎月は日を保つ(`2026-03-15` → `04-15`、`01-31` → `02-28`、`2024-01-31` → `02-29`)、毎年(`2024-02-29` → `2025-02-28`)。知らない規則は null | — |
| IO-086 | 利用者 | 書式 | 整合 | L1 | `parseDriveFiles`: JSON の配列を読み、`id` と `url` の無い要素と壊れた JSON は捨てる。`driveKind` は MIME からドキュメント / スプレッドシート / スライド / PDF / ファイル | — |
