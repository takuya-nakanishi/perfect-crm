# 04 API の契約

画面とバックエンドのあいだの約束。**型の正は `frontend/src/api/types.ts`、振る舞いの正はモック(`frontend/src/mocks/engine.ts`)。**
この文書は、その 2 つを読まなくても全体が分かるための地図。食い違ったら型とモックが正しい。

バックエンド(J-021)はこの契約どおりに作る。画面側の実装は `frontend/src/api/http.ts` に既にある。

## 1. 約束ごと

- ベースは `/api/v1`。画面と同じオリジン(Caddy が `/api/*` を `api` へ流す)。認証はセッション Cookie
- JSON の列名は **DB の列名そのまま**(snake_case)。ID は UUID、日付は `YYYY-MM-DD`、日時は ISO 8601(UTC)、金額は円の整数。書式付きの文字(`richtext`)は HTML で、**サーバは保存前に許した要素だけを残し、その結果から `@` の言及を取る**(この順。`frontend/src/lib/richtext.ts` と同じ規則。Python では `nh3` のような現行のライブラリを使い、非推奨の `bleach` は使わない)
- 参照は ID で返し、表示名は応答の `references` に添える(§2)
- エラーは HTTP ステータス + `{ "code": "...", "message": "..." }`。未ログインは 401、無いレコードは 404、入力の不備は 400

## 2. エンドポイント

| メソッドとパス | 役割 | 応答 |
|---|---|---|
| `GET /session` | いまの利用者 | `Session`。未ログインは 401 |
| `POST /session` | ログイン(`email`・`password`) | `Session` |
| `DELETE /session` | ログアウト | 204 |
| `GET /meta` | テーブル・項目・ビュー・利用者の定義。起動時に 1 回 | `MetaResponse` |
| `POST /meta/objects` | テーブルを作る(本文に `ObjectInput`)。§6 | `MetaResponse` |
| `PUT /meta/objects/{key}` | テーブル設定を保存する(本文に `ObjectInput`。項目は全量) | `MetaResponse` |
| `DELETE /meta/objects/{key}` | テーブルの論理削除 | `MetaResponse` |
| `POST /meta/objects/{key}/restore` | その取り消し | `MetaResponse` |
| `PUT /meta/objects/order` | サイドバーの並び(本文 `{ keys: [...] }`。いまあるテーブル全部を順に) | `MetaResponse` |
| `POST /meta/views` | ビューを作る(本文は `ViewInput` + `object`)。§6 | `MetaResponse` |
| `PUT /meta/views/{id}` | ビューを保存する(本文に `ViewInput`。name・type・config・pin の全量) | `MetaResponse` |
| `DELETE /meta/views/{id}` / `POST /meta/views/{id}/restore` | ビューの論理削除と取り消し。最後の 1 枚は消せない | `MetaResponse` |
| `PUT /meta/views/order` | タブの並び(本文 `{ object, ids }`) | `MetaResponse` |
| `POST /objects/{object}/records/query` | レコードの一覧(本文に `ListParams`) | `ListResponse` |
| `GET /objects/{object}/records/{id}` | 1 件 | `RecordResponse` |
| `POST /objects/{object}/records` | 作成(本文は列名 → 値) | `RecordResponse` |
| `PATCH /objects/{object}/records/{id}` | 更新(変える列だけ) | `RecordResponse` |
| `DELETE /objects/{object}/records/{id}` | 削除(論理削除) | 204 |
| `POST /objects/{object}/records/{id}/restore` | 削除の取り消し | `RecordResponse` |
| `POST /objects/{object}/aggregate` | 集計(本文に `AggregateParams`) | `AggregateResponse` |
| `GET /objects/{object}/records/{id}/timeline` | そのレコードの時系列(活動 + 言及 + 完了したタスク)。§9 | `TimelineResponse` |
| `POST /objects/{object}/import` | CSV の取り込み(本文に `ImportParams`)。§7 | `ImportResponse` |
| `POST /objects/{object}/export` | CSV の書き出し(本文に `ListParams`。省けば全件) | `text/csv` |
| `GET /settings/mcp/tokens` / `POST` / `DELETE …/{id}` | MCP のアクセストークン(管理者)。発行の応答だけ全文(`secret`)を返す。§10 | `McpToken[]` / `McpTokenCreated` / 204 |
| `GET /settings/forms` / `POST` / `PUT …/{id}` / `DELETE …/{id}` / `POST …/{id}/rotate` | Web フォームの定義(管理者)。§10 | `WebForm` |
| `POST /forms/{key}` | **Web フォームの受け口(認証なし)**。form-urlencoded か JSON。§10 | `RecordResponse`(HTML のフォームからは `redirect_url` へ 303、無ければ小さな「受け付けました」の画面) |
| `GET /drive/files?q=` | ログインしている利用者のマイドライブを探す。§8 | `DriveFile[]` |
| `POST /objects/{object}/records/{id}/drive/{field}/document` | 「マイドライブ / CRM / テーブル名 / レコード名」の Google ドキュメントを作り、その項目に付ける。§8 | `RecordResponse` |
| `GET /search?q=` | 全テーブルの横断検索 | `SearchResponse` |

一覧が `GET` でなく `POST …/query` なのは、フィルタが入れ子になりクエリ文字列に収まらないため。

`ListResponse` の形:

```json
{
  "records": [{ "id": "…", "name": "配車管理のクラウド移行", "account_id": "0100…0002", "stage": "negotiation", "amount": 12500000, "close_date": "2026-10-11" }],
  "total": 28,
  "references": { "accounts": { "0100…0002": { "id": "0100…0002", "name": "北浜ロジスティクス株式会社", "subtitle": "運輸・物流" } }, "users": { "…": { "id": "…", "name": "Takuya" } } }
}
```

`limit: 0` を渡すと `records` は空で `total` だけが返る(サイドバーの件数に使う)。

## 3. フィルタ

```json
{ "and": [
  { "field": "status", "op": "ne", "value": "done" },
  { "or": [ { "field": "due_date", "op": "lte", "value": "$today" }, { "field": "due_date", "op": "is_empty" } ] }
] }
```

- 演算子: `eq` `ne` `in` `not_in` `lt` `lte` `gt` `gte` `contains` `is_empty` `is_not_empty`。`and` / `or` で入れ子にできる
- 値に書けるマクロ(**サーバが解決する**): `$today`、`$today+7`、`$today-30`、`$start_of_month`、`$end_of_month`、`$me`。「今日」は**ワークスペースの時刻帯**(`workspace.timezone`。利用者ごとには持たない。08 §2)での今日
- 真理値(画面の `lib/filter.ts` と同じにする。J-021 の受け入れ条件): `eq` は NULL に対して偽、**`ne` / `not_in` は NULL を含む**(空も「違う」。SQL は `IS DISTINCT FROM` / `NOT IN (…) OR IS NULL`)、`lt` 〜 `gte` は NULL に対して偽、`contains` は文字の列だけ、`is_empty` は NULL と空文字(複数選択は空の配列も)。**複数選択(JSON の配列)**は `eq` / `in` が「どれかを含む」、`ne` / `not_in` が「どれも含まない」(SQL は jsonb の `?|`)。日時の列を日付と比べるときは、ワークスペースの時刻帯での日付に直してから比べる(UTC のまま比べると、朝の完了が前日扱いになる)
- `q`(一覧上部の絞り込み)は文字の列への部分一致。全角半角・大文字小文字・ひらがなカタカナを区別しない

同じフィルタを画面も評価する(`frontend/src/lib/filter.ts`)。楽観更新で「更新したらこのビューから外れるか」を先に判断するため。サーバと意味を揃えること。

## 4. 並び

`[{ "field": "due_date", "dir": "asc" }, { "field": "priority", "dir": "asc" }]`

- NULL は昇順・降順どちらでも末尾
- 選択肢の列は**定義順**(P1 → P4、見込み → 失注)。値の文字順ではない
- 参照の列(`relation`・`user`)は**参照先の表示名**の順

## 5. 集計

```json
{ "filter": { "field": "stage", "op": "not_in", "value": ["won", "lost"] },
  "group_by": { "field": "stage" },
  "measure": { "op": "sum", "field": "amount" } }
```

- `measure`: `count` / `sum` / `avg`。`weight_field` を付けると、その列(0〜100)を百分率として掛けてから足す(確度を掛けた見込み金額)
- `group_by` を省くと 1 行(全体の値)。応答の各行は `key`(生の値)、`label`(**サーバが解決した表示名**。選択肢のラベル、参照先の名前、`9月`、`9/21`)、`value`、選択肢なら `color`
- 日付の列は `bucket`(`day` / `month`)でまとめ、`range`(今日を基準に `from`〜`to`。単位は bucket と同じ)の区間を**空の区間も 0 で**全部返す
- 並び(`order`): 省略時は、選択肢なら定義順、日付なら時間順、それ以外は値の大きい順。`value_desc` を付けると選択肢でも値の大きい順(業種のような順序の無い区分向け)。`limit` で上位 n 件
- 値が空のグループは `key: null`、ラベルは「未設定」(関連先のテーブル別なら「関連先なし」)で末尾

割合(受注率など)は、画面が分子と分母の 2 回を呼んで割る。

## 6. テーブル設定

- 作成も更新も、本文は `ObjectInput`(`key`・`label`・`icon`・`color`・`fields`)。`fields` は**並び順どおりの全量**で、1 項目は `key`・`label`・`type`・`required`・`max_length`・`scale`・`placeholder`・`options`(選択肢)・`target`(参照先)
- 更新時、`fields` に無い項目は外れる(列の値は残る)。既にある項目の `key` と `type` は変えられない。ここに書けない属性(`semantic`・`in_create_form`・選択肢の `kind` など)は元のまま保つ
- 応答はどれも**変更後の `MetaResponse` 全体**。画面はそれをそのまま差し替える(もう一度 `GET /meta` を呼ばない)
- 規則に反する入力(列名の形式・重複・予約語、外せない項目の欠落、選択肢の無い選択肢型、参照先の無い参照型)は 400 と、人が読める `message`。画面も同じ規則を先に見るが、最後の判断はサーバ
- 決まりの全体は 02 §5
- **ビュー**(`ViewInput`): `type` を変えると `config` も丸ごと変わる(一覧 → カンバンなら列の代わりに `group_by`)。条件(`filter`)は画面では「条件を AND か OR で並べた 1 段」だけを編集し、それより深い入れ子は「高度な条件」として保つ。無い項目を指す条件・列・分け方は 400。条件の `value_label`(参照の表示名)はサーバが評価に使わず、そのまま保つ

## 7. CSV の取り込みと書き出し

- 書き出しは UTF-8(BOM 付き。Excel がそのまま開ける)。見出しは**項目名**、選択肢は**ラベル**、参照と利用者は**表示名**、チェックは「はい」
- 取り込みは、CSV の本文(`csv`)と、見出し → 列名の対応(`mapping`。`null` は取り込まない)を渡す。対応を省いた見出しは、サーバが項目名と列名から推測する。`dry_run: true` なら検証だけして書き込まない
- **文字から値への変換はサーバの仕事**: 数値(全角・カンマ・円記号を受ける)、日付(`2026-09-30`・`2026/9/30`・`2026年9月30日`)、選択肢(ラベルか値)、参照(**UUID か、参照先の表示名と一致するレコード。同名が複数なら行エラー**。黙って選ばない)、利用者(名前かメール)、チェック(はい / true / 1 / ○)。同じ変換を Web フォームの受け口(§10)も使う
- 読めない行は**飛ばして、読める行だけを取り込む**。応答に、行数(`total`)、取り込める行数(`valid`)、読めない行と理由(`errors`。先頭 20 件)、先頭 5 行(`sample`)、作成した ID(`created_ids`。画面の「元に戻す」が使う)
- システムが埋める列と `polymorphic`(タスクの関連先)は取り込めない。取り込みも、1 件ずつの作成と同じ経路(既定値・検証・業務ルール)を通る
- タブ区切り(Excel の範囲をコピーして貼り付けたもの)も同じ API で受ける。Shift_JIS の CSV は、画面が UTF-8 に直してから送る

## 8. Google ドライブ(`drive_files` 型の項目)

- 利用者ごとの Google アカウントで Drive API を叩く(バックエンドが OAuth の refresh token を持つ。J-035)。画面はトークンに触れない
- `POST …/drive/{field}/document`: 「マイドライブ / CRM / テーブルの表示名」のフォルダを探し、無ければ作り、その中にレコードの表示名の Google ドキュメントを作って、項目の末尾に付ける。応答は更新後のレコード
- `GET /drive/files?q=`: 名前の部分一致で 20 件まで。画面の「参照」はここから選び、項目の値(`DriveFile[]` の JSON)を `PATCH` で書く。**外してもドライブのファイルは消さない**
- 本番では Google Picker(画面側の部品)に替える余地がある。契約は「画面が `DriveFile[]` を書く」なので、どちらでも同じ

## 9. 時系列(レコードのパネルの「活動」)

`GET …/records/{id}/timeline` は、**サーバが 3 つを合成して**新しい順に返す(100 件まで)。画面は描くだけで、テーブルをまたぐ結合をしない。MCP や AI チャットが「この取引先の経緯」を読むときも同じ API。

| kind | 元 | 条件 |
|---|---|---|
| `activity` | 活動(`timeline` を持つテーブル) | 関連先がそのレコード |
| `mention` | 活動 | `mentions` にそのレコードが入っている(内容の `@` で言及された)。`related` に、その活動の本来の関連先を添える |
| `completion` | 完了できるテーブル(タスク) | 完了していて、関連先(polymorphic か relation)がそのレコード。日付は `completed_at` の日付 |

1 行は `kind`・`object`・`id`(押すと開く元のレコード)・`date`・`at`(同じ日の中の並び)・`subject`・`type`(活動の種別)・`body`(HTML。タスクは詳細を段落にしたもの)・`user_id`・`related`。
完了したタスクを活動に複製しないのは、初めから完了していたデータや取り込んだデータにも穴を空けないため(02 §3)。

## 10. 環境設定(管理者だけ。03 §5)

**MCP のトークン** — 利用者ごと・アプリごとに 1 本。サーバはハッシュだけを保存し、全文は発行の応答(`McpTokenCreated.secret`)でしか返さない。`last_used_at` と、`User-Agent` から推定した `client` で「どのアプリから繋がっているか」を見せる。失効は即時。MCP サーバ(J-028)はこのトークンを `Authorization: Bearer` で受け、その利用者として画面と同じコマンド層を呼ぶ。

**Web フォーム** — `WebForm` は「どのテーブルに、どの列を受け付け、どの既定値を足すか」。受け口 `POST /forms/{key}` は認証なしで、
1. `enabled` でなければ 404
2. `fields` に無い列は捨て、`defaults` を足す
3. `_gotcha`(人には見えない欄)が埋まっていたら、200 を返して何もしない(bot)
4. 受け口ごとに送信を間引く(例: 同じ IP から 1 分に 10 件まで。バックエンドで決める。J-039)
5. 画面からの作成と同じ経路(既定値・検証・業務ルール)でレコードを作る。担当は空(`defaults` で入れられる)
6. `Accept` が HTML なら `redirect_url` へ 303、無ければ小さな「受け付けました」の画面。JSON なら `RecordResponse`

`key` は URL に入る秘密。漏れたら `rotate` で作り直す(古い URL は 404)。

## 11. 書き込みの決まり

- `PATCH` は渡した列だけを変える。応答は、業務ルール(02 §3)を当てたあとの 1 行と、その参照先
- 作成時の既定値と、完了日時・確度の自動設定は**サーバの仕事**。画面は結果を受け取るだけ。**完了にする本文に `completed_at` も入っていれば、それを尊重する**(移行で元の日時を保つため)
- サーバは型(数値・日付・日時・真偽)と参照整合(参照先の行がある、関連先はテーブル名と ID の組で `targets` の中)を検証し、外れれば 400。文字から型への変換は取り込みと Web フォームだけが行う
- 画面は応答を待たずに表示を書き換え(楽観更新)、失敗したら元に戻して知らせる。応答が返ったら、関連する一覧・集計を読み直す

## 12. これから決めること

- ページング: いまは全件を返している(モックは数十件)。`limit` / `offset` は契約にあるが、画面は使っていない。数百件を超える前に、一覧の仮想スクロールと併せて入れる
- 変更の記録(誰が・いつ・何を)と、その参照 API
- MCP とチャットが使うコマンド層を、この HTTP API と同じ関数にどう揃えるか(03 §6・§7)
