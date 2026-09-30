# 04 API の契約

画面とバックエンドのあいだの約束。**型の正は `frontend/src/api/types.ts`、振る舞いの正はモック(`frontend/src/mocks/engine.ts`)。**
この文書は、その 2 つを読まなくても全体が分かるための地図。食い違ったら型とモックが正しい。

バックエンド(J-021)はこの契約どおりに作る。画面側の実装は `frontend/src/api/http.ts` に既にある。

## 1. 約束ごと

- ベースは `/api/v1`。画面と同じオリジン(Caddy が `/api/*` を `api` へ流す)。**認証はアプリ自身が持つ**(2026-10-01。01 D-14、03 §5): 画面はセッションの Cookie、Android アプリは `Authorization: Bearer`(OAuth の access token)。無い・切れた → 401 `unauthenticated`。Cookie で入った書き込み(GET 以外)は `Origin` が公開 URL と同じものだけを受ける(違えば 403 `bad_origin`)。口の一覧は §16。**切り替え(J-055)までは、本番は Cloudflare Access の JWT(`Cf-Access-Jwt-Assertion`)で利用者を決めている**
- JSON の列名は **DB の列名そのまま**(snake_case)。ID は UUID、日付は `YYYY-MM-DD`、日時は ISO 8601(UTC)、金額は円の整数。書式付きの文字(`richtext`)は HTML で、**サーバは保存前に許した要素だけを残し、その結果から `@` の言及を取る**(この順。`frontend/src/lib/richtext.ts` と同じ規則。Python では `nh3` のような現行のライブラリを使い、非推奨の `bleach` は使わない)
- 参照は ID で返し、表示名は応答の `references` に添える(§2)
- エラーは HTTP ステータス + `{ "code": "...", "message": "..." }`。未ログインは 401、無いレコードは 404、入力の不備は 400、いまのデータの状態でできない操作(必須の参照で使われているレコードの削除など)は 409。`message` は人がそのまま読める文で、画面はそれを出す

## 2. エンドポイント

| メソッドとパス | 役割 | 応答 |
|---|---|---|
| `GET /session` | いまの利用者 | `Session`。未ログイン・切れた → 401 `unauthenticated`(画面はログインの画面へ)。§16 |
| `POST /session` | ログインの 1 段目(`email`・`password`)。通れば 2 段目(TOTP)へ。§16 | `LoginResult`。違う → 401 `invalid_credentials`。続けて失敗 → 429 `too_many_attempts` |
| `POST /session/totp` | ログインの 2 段目(6 桁)。通ればセッションの Cookie を置く。§16 | `Session` |
| `DELETE /session` | ログアウト(このセッションを消し、Cookie を消す) | 204 |
| `GET /session/google?next=` / `GET /session/google/callback` | Google でログイン(ブラウザで開く。fetch しない)と、その戻り。§16 | 303 |
| `GET /account` ほか | パスワードの変更、Google の結び・外し、ログイン中の端末とアプリ。§16 | |
| `GET /meta` | テーブル・項目・ビュー・サイドバーのフォルダ・利用者の定義。起動時に 1 回 | `MetaResponse` |
| `POST /meta/objects` | テーブルを作る(本文に `ObjectInput`)。§6 | `MetaResponse` |
| `PUT /meta/objects/{key}` | テーブル設定を保存する(本文に `ObjectInput`。項目は全量) | `MetaResponse` |
| `DELETE /meta/objects/{key}` | テーブルの論理削除 | `MetaResponse` |
| `POST /meta/objects/{key}/restore` | その取り消し | `MetaResponse` |
| `PUT /meta/sidebar` | サイドバーの並びとフォルダを、上から順に**全量で**(本文 `{ items: [...] }`。1 行はテーブル `{ type: "object", key }` かフォルダ `{ type: "folder", id, label, keys }`)。上から 1 からの通し番号を振る(フォルダ → その中のテーブル → 次の…)。本文に無いフォルダは消え(中のテーブルはフォルダの外へ)、本文に無いテーブルは元の順で末尾に続く(フォルダの外)。新しいフォルダの id は画面が振る(UUID)ので、「元に戻す」は前の並びを送り直すだけ。無い・削除中のテーブル、同じテーブルやフォルダが 2 回、空の名前、UUID でない id は 400。管理者だけ。2026-09-26 に `PUT /meta/objects/order` から替えた。02 §2・05 §13 | `MetaResponse` |
| `POST /meta/views` | ビューを作る(本文は `ViewInput` + `object`)。§6 | `MetaResponse` |
| `PUT /meta/views/{id}` | ビューを保存する(本文に `ViewInput`。name・type・config・pin の全量) | `MetaResponse` |
| `DELETE /meta/views/{id}` / `POST /meta/views/{id}/restore` | ビューの論理削除と取り消し。最後の 1 枚は消せない | `MetaResponse` |
| `PUT /meta/views/order` | タブの並び(本文 `{ object, ids }`) | `MetaResponse` |
| `POST /objects/{object}/records/query` | レコードの一覧(本文に `ListParams`) | `ListResponse` |
| `GET /objects/{object}/records/{id}` | 1 件 | `RecordResponse` |
| `POST /objects/{object}/records` | 作成(本文は列名 → 値) | `RecordResponse` |
| `PATCH /objects/{object}/records/{id}` | 更新(変える列だけ) | `RecordResponse` |
| `DELETE /objects/{object}/records/{id}` | 削除(論理削除)。**必須の参照項目が生きている行からこのレコードを指していれば 409 `referenced`**(理由は `message`)。それ以外で指している参照(relation・関連先)は空になる(02 §4) | 204 |
| `POST /objects/{object}/records/{id}/restore` | 削除の取り消し。削除のときに外した参照を付け直す(空のままの列だけ)。削除中に必須の参照の相手を消されていれば、相手が削除中のあいだ 409 `reference_deleted` | `RecordResponse` |
| `POST /objects/{object}/aggregate` | 集計(本文に `AggregateParams`) | `AggregateResponse` |
| `GET /objects/{object}/records/{id}/timeline` | そのレコードの時系列(活動 + 言及 + 完了したタスク)。§9 | `TimelineResponse` |
| `POST /objects/{object}/import` | CSV の取り込み(本文に `ImportParams`)。§7 | `ImportResponse` |
| `POST /objects/{object}/export` | CSV の書き出し(本文に `ListParams`。省けば全件) | `text/csv` |
| `GET /settings/mcp/tokens` / `POST` / `DELETE …/{id}` | MCP のアクセストークン(管理者)。発行の応答だけ全文(`secret`)を返す。§10 | `McpToken[]` / `McpTokenCreated` / 204 |
| `GET /settings/mcp/connections` / `DELETE …/{id}` | OAuth で許可したアプリ(Claude のカスタムコネクタ。管理者)。切ると、その許可のトークンが消え、次の呼び出しから 401。§13 | `McpConnection[]` / 204 |
| `GET /oauth/requests/{id}` / `POST`(`{ approve }`) | 許可の画面(`/oauth/consent`)。依頼の中身を見せ、決めたら Claude の戻り先を返す。無い・期限切れは 404。§13 | `OAuthRequest` / `{ redirect_url }` |
| `GET /settings/forms` / `POST` / `PUT …/{id}` / `DELETE …/{id}` / `POST …/{id}/rotate` | Web フォームの定義(管理者)。§10 | `WebForm` |
| `POST /forms/{key}` | **Web フォームの受け口(認証なし)**。form-urlencoded か JSON。§10 | `RecordResponse`(HTML のフォームからは `redirect_url` へ 303、無ければ小さな「受け付けました」の画面) |
| `GET /settings/slack` | 繋いでいる Slack のチャンネル(管理者。いくつでも)。§14 | `SlackStatus`(`{ configured, channels }`) |
| `POST /settings/slack/connect` | Slack の許可の画面の URL をもらう(管理者。本文 `{ return_to }` は任意で、許可のあとに戻す画面。環境設定の中だけ)。チャンネルはそこで選ぶ。§14 | `{ url }` |
| `GET /slack/callback?code&state` | **Slack からの戻り**(誰の許可か・どこへ戻すかは署名付きの `state` が持つ)。§14 | 303 で `<return_to>?slack=connected&channel=<id>` / `denied` / `error`(既定の戻り先は `/settings/slack`) |
| `POST /settings/slack/{id}/test` | そのチャンネルへテスト通知を送り、結果を記録する(管理者)。無いチャンネルは 404。§14 | `SlackStatus`(送れたかは、そのチャンネルの `last_error` が空か) |
| `DELETE /settings/slack/{id}` | チャンネルを外す(管理者)。Works が Webhook を捨てるだけで、Slack のアプリは外さない。ワークフローが送り先に選んでいれば 409 `channel_in_use`。§14 | 204 |
| `GET /settings/workflows` / `POST` / `PUT …/{id}` / `DELETE …/{id}` / `POST …/{id}/restore` | ワークフローの定義(管理者。削除は論理削除で、`restore` が「元に戻す」)。§15 | `Workflow[]` / `Workflow` / 204 |
| `GET /settings/workflows/{id}/runs` | 実行記録(管理者。新しい順、既定 50 件・`?limit=` で 200 まで)。§15 | `WorkflowRun[]` |
| `POST /settings/workflows/runs/{id}/retry` | 失敗・見送りの実行を、もう一度送る(管理者)。それ以外は 409 `not_retryable`。§15 | `WorkflowRun` |
| `POST /settings/workflows/test` | 保存前の定義(`WorkflowInput`)のまま、アクションをその場で 1 回動かす(管理者。実行記録には残さない)。§15 | `WorkflowTestResult` |
| `GET /google/status` | その利用者が Google を繋いでいるか。§8 | `GoogleStatus` |
| `POST /google/connect` | 許可の画面の URL をもらう。§8 | `{ url }` |
| `GET /google/callback?code&state` | **Google からの戻り**(ここだけ Cookie を見ない)。§8 | 303 で画面へ(`?google=connected` / `denied` / `error`) |
| `DELETE /google/connection` | 繋ぎを外す(Google 側の許可も取り消す)。§8 | 204 |
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

**利用者ごとの Google アカウント**で Drive API を叩く(2026-09-23 に実装。J-035)。画面はトークンに触れない。

| 手順 | 中身 |
|---|---|
| 繋ぐ | `POST /google/connect` で許可の画面の URL をもらい、画面はそこへ送り出す。戻り(`GET /google/callback`)でサーバが token を受け取り、**refresh token を暗号化して `google_accounts` に仕舞う**。終わったら `?google=connected` を付けて画面へ 303 |
| 使う | `GET /drive/files?q=`(名前の部分一致で 20 件。フォルダとゴミ箱は出さない)、`POST …/drive/{field}/document`(下記)。access token は控えを使い回し、切れていれば refresh token で取り直す |
| 外す | `DELETE /google/connection`。Google 側の許可も取り消し、行を消す。**ドライブのファイルは消さない** |

- `POST …/drive/{field}/document`: 「マイドライブ / CRM / テーブルの表示名」のフォルダを探し、無ければ作り、その中にレコードの表示名の Google ドキュメントを作って、項目の末尾に付ける。応答は更新後のレコード
- 画面の「参照」は `GET /drive/files` から選び、項目の値(`DriveFile[]` の JSON)を `PATCH` で書く。**外してもドライブのファイルは消さない**
- **state は署名だけで持つ**(DB にも Cookie にも置かない)。中身は「利用者の ID + 発行時刻 + 使い捨ての値」で、PKCE の verifier も同じ鍵から導く。戻りが自分の出したものかは署名で分かるので、途中の状態を保存しなくてよい。古い state(15 分)は断る
- スコープは `drive.readonly`(参照)+ `drive.file`(作成)+ `userinfo.email`・`openid`(繋いだアドレスの表示)。`drive.readonly` は制限付きだが、**OAuth アプリを「内部」(Workspace 限定)で公開する限り審査は要らない**(GCP 側の手順は `docs/runbook/01` §6)
- 繋いでいない・許可が切れた → **409 `google_reauth`**(画面は「Google に接続」を出す)。管理者が `.env` を入れていない → **503 `google_not_configured`**。Google が落ちている → 502
- Google Picker(画面側の部品)に替える余地はあるが、いまは採っていない。**Caddy の CSP が `script-src 'self'` で、Google のスクリプトと iframe を入れると緩めることになる**ため。契約は「画面が `DriveFile[]` を書く」なので、替えても同じ

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
3. `_gotcha`(人には見えない欄)が埋まっていたら、200 を返して何もしない(bot)。レコードも `submissions` も増やさない。JSON なら `id`・`created_at`・`updated_at` だけの空の `RecordResponse` を返し、弾かれたと bot に気づかせない(2026-09-22 決定。SET-046)
4. 受け口ごとに送信を間引く(例: 同じ IP から 1 分に 10 件まで。バックエンドで決める。J-039)
5. 画面からの作成と同じ経路(既定値・検証・業務ルール)でレコードを作る。担当は空(`defaults` で入れられる)
6. `Accept` が HTML なら `redirect_url` へ 303、無ければ小さな「受け付けました」の画面。JSON なら `RecordResponse`

`key` は URL に入る秘密。漏れたら `rotate` で作り直す(古い URL は 404)。

## 11. 書き込みの決まり

- `PATCH` は渡した列だけを変える。応答は、業務ルール(02 §3)を当てたあとの 1 行と、その参照先
- 作成時の既定値と、完了日時・確度の自動設定は**サーバの仕事**。画面は結果を受け取るだけ。**完了にする本文に `completed_at` も入っていれば、それを尊重する**(移行で元の日時を保つため)
- サーバは型(数値・日付・日時・真偽)と参照整合(参照先の行があって削除中でない、関連先はテーブル名と ID の組で `targets` の中)を検証し、外れれば 400。文字から型への変換は取り込みと Web フォームだけが行う
- **定義に無い列が本文にあれば 400**(`定義に無い列です: <列名>`)。黙って捨てない——MCP や AI チャットが項目名を間違えたとき、値が消えたことに気づけないため。DB も無い列への INSERT は弾く。`readonly` の列は本文にあってよい(上の `completed_at` と同じ扱い)。`id` はサーバが付けるので本文に入れない(2026-09-22 決定。REC-062)
- 画面は応答を待たずに表示を書き換え(楽観更新)、失敗したら元に戻して知らせる。応答が返ったら、関連する一覧・集計を読み直す

## 12. これから決めること

- ページング: いまは全件を返している(モックは数十件)。`limit` / `offset` は契約にあるが、画面は使っていない。数百件を超える前に、一覧の仮想スクロールと併せて入れる
- 変更の記録(誰が・いつ・何を)と、その参照 API
- チャット(03 §7)が使うコマンド層。MCP は `app/records/service.py` などを直に呼ぶ形にした(§13)ので、チャットも同じ関数を呼ぶのが素直

## 13. MCP と、Claude のカスタムコネクタの OAuth(03 §6)

`/api/v1` の外にある口。どれも公開 URL の直下(`WORKS_PUBLIC_URL`。既定は手元の web)で、Caddy が api へ流す。

| 口 | 誰が叩くか | 中身 |
|---|---|---|
| `POST /mcp` | Claude(Anthropic のクラウド)、トークンを付けたアプリ | MCP(Streamable HTTP、stateless、JSON の応答)。`Authorization: Bearer <OAuth の access token か wks_>`。無ければ 401 + `WWW-Authenticate: Bearer resource_metadata=…` |
| `GET /.well-known/oauth-protected-resource/mcp` | Claude | 資源のメタデータ(RFC 9728)。`resource` は `<公開 URL>/mcp` と 1 文字も違わない |
| `GET /.well-known/oauth-authorization-server` | Claude | 認可サーバのメタデータ(RFC 8414)。発行元は公開 URL。`code_challenge_methods_supported: ["S256"]`、`registration_endpoint` あり |
| `POST /register` | Claude | 動的登録(RFC 7591)。戻り先が Claude(`https://claude.ai/api/mcp/auth_callback` か loopback の `/callback`)でなければ 400 `invalid_redirect_uri` |
| `GET /authorize` | 本人のブラウザ | 依頼を置き(10 分で切れる)、画面の `/oauth/consent?request=…` へ送る。ログインしていなければ、画面がログインの画面を経てから戻す(05 §15) |
| `POST /token` | Claude | 認可コード(1 回きり、5 分)→ access(1 時間)+ refresh(90 日)。refresh は使うたびに新しい組に替え、古いものは `invalid_grant` |
| `POST /revoke` | Claude | その許可ごと消す |

- 許可(`oauth_grants`)が環境設定の「接続中のアプリ」の 1 行。コードとトークンは sha256 だけを持つ。利用者を消すと、その人の許可も消える
- ツールの呼び出しは、許可した人を「誰として」にして、画面と同じ関数を通る(既定値の「担当は自分」も同じ)。失敗は 400 の文(`定義に無い列です` など)をツールのエラーとして返し、AI が読んで直せるようにする
- **Android アプリも同じ `/authorize`・`/token`・`/revoke` を使う**(2026-10-01。03 §5)。違いは 3 つ: ①動的登録ではなく、初めから入れてある公開クライアント(`works-android`)②スコープは `api`(`/api/v1` に入れる。Claude の `works` は `/mcp` だけ)③許可のカードを出さない(戻り先が https で、Digital Asset Links によって Works のアプリだと確かめられるため。RFC 8252 §8.6。ログインが通れば許可したとみなす)。`/register` で `api` を求めても与えない

## 14. Slack のチャンネル(2026-09-30)

本人の指示: 「Web フォームから登録がなされたとき、自社の Slack に飛ばす」。leadcast-sales の Slack 通知(`docs/notifications/SLACK.md`)と同じ方式にした。
違いは 2 つ。**Slack アプリは、SANEi CLOVER Inc. の Slack にある llm-wiki の稼働通知のアプリを流用し、その Slack にだけ入れる**(2026-09-30 本人の判断。leadcast-sales は LEADCAST Inc. の Slack に専用のアプリを作り、他社へ配布している)。そのため、**チャンネルを外しても Slack のアプリは外さない**(下の「外す」)。設定は `docs/runbook/01` §6b。
同日、**何をいつ知らせるかはワークフロー(§15)で決める形に替え、チャンネルを複数持てるようにした**(当初は「Web フォームの登録を 1 チャンネルへ」だけ)。ここはその送り先の管理。

**方式: OAuth v2 で `incoming-webhook` の権限だけを求め、投稿先のチャンネルは Slack の許可の画面で選ばせる。**
許可が済むと、Slack が選ばれたチャンネル専用の Incoming Webhook の URL を払い出す。Works はそれを 1 チャンネル(`slack_connections` の 1 行)として仕舞う。許可を通すたびにチャンネルが増える。

| 手順 | 中身 |
|---|---|
| 繋ぐ | `POST /settings/slack/connect`(本文 `{ return_to }` は任意)で許可の画面(`https://slack.com/oauth/v2/authorize?scope=incoming-webhook&…`)の URL をもらい、画面はそこへ送り出す。戻り(`GET /slack/callback`)でサーバが `oauth.v2.access` に認可コードを渡し、**Webhook の URL を暗号化して仕舞う**(応答に入っているボットトークンは捨てる。使い道が無い)。終わったら `?slack=connected&channel=<id>` を付けて `return_to` へ 303 |
| 繋ぎ直す | **同じチャンネル(`team_id` と `channel_id` の組)を許可し直すと、その行の Webhook を差し替える**(行は増えず、id も変わらない。ワークフローは id で指しているので、選び直さなくてよい)。「要再接続」もこれで消える |
| 確かめる | `POST /settings/slack/{id}/test` でテスト通知。結果はそのチャンネルに記録し、状態を返す |
| 外す | `DELETE /settings/slack/{id}`。行を消すだけ。**ワークフローが送り先に選んでいるあいだは 409 `channel_in_use`**(外すと、そのワークフローが黙って届かなくなる。削除中のワークフローは数えない)。**`apps.uninstall` は呼ばない** — アプリを外すと、そのアプリが払い出した Webhook が全部止まり、同じアプリを使う llm-wiki の稼働通知も止まる(2026-08-22 にアプリの削除で実際に止まった)。Slack 側に残った Webhook は、画面の「Slack で設定を開く」(`configuration_url`)から消す |

- **`return_to` は環境設定の中のパスだけ**(`^/settings(/[a-z][a-z-]*)*$`)。外の URL・`//…`・`..` は既定の `/settings/slack` に差し替える(開いたリダイレクトにしない)。戻り先は署名付きの `state` に入れて持ち、戻りでは `state` から取る(クエリは信じない)。`state` を読めないときは、戻り先も信じずに既定へ戻す
- 求める権限は 1 つ(`chat:write` も `channels:read` も求めない)。非公開のチャンネルも、許可する本人が入っていれば選べる。投稿した通知は後から直せない・消せない(Incoming Webhook の仕様)。チャンネルは Webhook ごとに決まり、本文で上書きできない(だからチャンネルを増やすたびに許可を通す)
- **state は署名だけで持つ**(Google と同じ。§8)。用途を混ぜるので、Google の state は Slack の戻りに使えない。戻ったとき、その人がまだ管理者かを見る。組織(Enterprise Grid)単位のインストールと、`https://hooks.slack.com/services/` で始まらない URL は保存しない
- **人が書いた文字は Slack の書式の `&` `<` `>` をエスケープしてから載せる**(`<!channel>` でチャンネル全員に通知を飛ばす・`<https://…|…>` で偽のリンクを作る、を防ぐ。Web フォームは誰でも送れる)。リンクはボタンにせず mrkdwn のリンクにする(ボタンは Slack がアプリの Interactivity の口へ知らせようとし、Works はその口を持たない)。ブロックの上限(header 150 字・section 3000 字・field 2000 字・fields 10 個)の内側で切る
- 失敗の分類: 429・5xx・繋がらないは一時的(ワークフローの送り係が間を空けて送り直す。§15。画面のテスト通知は 1 回だけ待って送り直す)。`no_service`・`channel_not_found`・`channel_is_archived`・`action_prohibited` などの「投稿先が失われた」類は `needs_reconnect`(画面は「要再接続」と「繋ぎ直す」)。送れたら前の失敗を消す
- 資格情報が無い: 管理者が `.env` を入れていなければ、`configured: false`(画面は「資格情報が入っていません」)、`connect` は 503 `slack_not_configured`
- 戻り先(`<WORKS_PUBLIC_URL>/api/v1/slack/callback`)は Access の内側のまま(戻ってくるのは、Works にログインしている本人のブラウザ)。Slack は HTTPS 以外の戻り先を受け付けないので、手元(`http://127.0.0.1`)では本物の往復は試せない。本物の往復は `test_slack.py` が偽物の Slack で確かめる

## 15. ワークフロー(2026-09-30)

本人の指示: 「リード登録時に Slack 通知させるトリガーを、リードのみならず汎用的に使えるように。名前はワークフロー、将来の拡張もできる UI と作りに」(01 D-13)。
**1 つのワークフロー = きっかけ 1 つ + アクションの並び。**表は 02 §7、送り係は 03 §11、画面は 05 §14。正はモック(`frontend/src/mocks/workflows.ts`)。

`WorkflowInput`(作成・更新・テスト送信の本文):

```json
{
  "name": "新しいリード",
  "enabled": true,
  "object": "leads",
  "trigger": { "event": "created", "filter": { "field": "source", "op": "eq", "value": "web" }, "origins": ["app", "form", "mcp", "auto"] },
  "actions": [{ "id": "a3f9c2d1e0", "type": "slack", "channel": "<SlackChannel の id>", "fields": ["company", "email", "phone"] }]
}
```

| 項目 | 決まり |
|---|---|
| `trigger.event` | `created`(作成されたとき。条件は任意で、あれば作ったレコードが満たすときだけ)/ `matched`(条件を満たしたとき。条件は必須。作成・更新で、**満たしていなかったものが満たした瞬間に 1 回**。満たしたまま直しても動かない。外れてからまた満たせばもう 1 回) |
| `trigger.filter` | ビューと同じ形(§3)で、**同じ関数で SQL にしてその 1 行に当てる**(ビューと意味が食い違わない)。「自分」(`$me`)は 400(誰の書き込みでも動くので決まらない)。無い項目・型に合わない値は保存のときに 400。保存したあとで項目を外したら、そのワークフローは動かず `problems` に出る(条件を外して広く動かさない) |
| `trigger.origins` | どこからの書き込みで動かすか。`app`(画面)・`form`(Web フォーム)・`mcp`(AI)・`auto`(繰り返しのタスクの次回)・`import`(CSV の取り込み)。1 つ以上。この順に揃える。画面の既定は `import` を除く 4 つ |
| `actions` | 1〜10 個。`id` は画面が振る重ならない名前(64 字まで。実行記録が指す)。`type` はいまは `slack` だけ: `channel`(`SlackChannel` の id。必須)、`fields`(載せる項目。20 個まで。表示名は見出しの下に必ず出るので重ねない) |
| `enabled` | 真偽。オフのあいだは動かず、**オフにする前に入った送信待ちも見送る** |

**動く仕組み**(書き込みの経路 `service.insert` / `update` の中):
1. そのテーブルの、オンで削除中でなく、`origins` にこの書き込みの経路が入っているワークフローを引く
2. 更新なら、書き換える前に「`matched` のうち、もう満たしているもの」を覚えておく
3. 書いたあと、条件をその 1 行に当て、動かすものについてアクションごとに**実行記録(`queued`)を入れる**。本文はこのときのレコードの値で作って写す
4. トランザクションが確定したら送り係が起きて送る(03 §11)。取り消されたら実行記録も残らない
5. 何が起きてもレコードの書き込みは止めない(SAVEPOINT で囲む)

**Slack に知らせる の本文**(`app/slack/message.py` の `workflow_notice`): 見出しはワークフローの名前、次にレコードの表示名(太字)、選んだ項目(選択肢はラベル、参照は表示名、日時はワークスペースの時刻、長い文は 1 段ぶん、空は載せない)、末尾に「〈テーブル〉に作成(または 〈テーブル〉が条件を満たしました)· 〈誰〉(〈どこから〉)· Works で開く」。要約(`text`)は `[Works] <ワークフローの名前>: <表示名>`。テスト送信は見出しに `[テスト]` を付ける。エスケープと上限は §14。

**実行記録**(`WorkflowRun`): `status` は `queued`(待ち)→ `running`(実行中)→ `done`(済み)/ `failed`(失敗)/ `skipped`(見送り: 送る前にオフ・削除にされた)。一時的な失敗は `queued` に戻して間を空け(`next_attempt_at`)、5 回目で `failed`。`retry` は `failed` / `skipped` だけを `queued` に戻す(試した回数は 0 から)。削除中のワークフローの実行は送り直せない(先に戻す)。

**`Workflow`**(一覧と 1 件): 定義に加えて `created_by`・`created_at`・`updated_at`、`last_run`(直近の実行の状態・時刻・失敗)、`problems`(いま動けない理由: テーブルが削除中・条件の項目が無い・チャンネルが外された・要再接続)。

**テスト送信**(`POST /settings/workflows/test`): 保存前の定義を同じ検証に通し、そのテーブルで条件を満たす最新の 1 件(無ければ最新の 1 件、テーブルが空なら見本の値)で、アクションをその場で 1 回動かす。実行記録には残さない。応答は使ったレコードと、アクションごとの成否。

**これまでの Web フォームの通知の移行**(マイグレーション 0008): Slack と繋いでいて Web フォームがあれば、テーブルごとに「Web フォームからの登録」(作成されたとき・`origins: ["form"]`・載せる項目はそのテーブルのフォームの項目を合わせたもの・送り先は繋いでいたチャンネル)を作る。Web フォームの受け口は、もう自分では知らせない。

## 16. ログインとアカウント(2026-10-01。03 §5)

ログインはアプリ自身が持つ(01 D-14)。型は `Session`(いまと同じ)・`SessionOptions`・`LoginResult`・`TotpSetup`・`Account`・`AccountSession`。**切り替え(J-055)までは、本番は §1 のとおり Access の JWT で動いている。**

**画面のログイン**(Cookie `__Host-works_session`)

| メソッドとパス | 役割 | 応答 |
|---|---|---|
| `GET /session/options` | ログインの画面が出すもの(未ログインで読める) | `SessionOptions`: `{ google: boolean }`(Google の設定が `.env` にあるか) |
| `POST /session` | 本文 `{ email, password }`。通っても**まだセッションを作らず**、2 段目を待つ札の Cookie `__Host-works_login`(5 分)を置く | `LoginResult`: `{ status: 'totp' }`(6 桁を待つ)か、`{ status: 'totp_setup', setup: TotpSetup }`(2 段階認証がまだの人。設定してから入る)。モックは `{ status: 'ok', session }`(2 段目を出さない)。違う → 401 `invalid_credentials`「メールアドレスかパスワードが違います」(メールアドレスが無いときも同じ文・同じくらいの時間)。続けて失敗 → 429 `too_many_attempts`(`Retry-After` と、待つ時間の文)。空 → 400 |
| `POST /session/totp` | 本文 `{ code }`(6 桁)。札の 2 段目を済ませ、セッションを作って Cookie を置く(前のセッションは引き継がない)。`totp_setup` の札なら、この 6 桁で設定も済ませる | `Session`。違う → 400 `invalid_code`「確認コードが違います」(端末の時刻のずれにも触れる)。札が無い・切れた・5 回違えた → 401 `login_expired`(パスワードからやり直す)。続けて失敗 → 429 |
| `DELETE /session` | ログアウト。このセッションの行を消し、Cookie を消す | 204 |
| `GET /session/google?next=/o/tasks` | Google でログイン。短命の Cookie(state・nonce・PKCE の verifier・戻り先)を置き、Google の許可の画面へ送る | 303 |
| `GET /session/google?link=1` | ログイン中の本人に Google を結ぶ(アカウントの画面から) | 303 |
| `GET /session/google/callback?code&state` | Google からの戻り。state を Cookie と照らし、ID トークンを確かめ、利用者を決めてセッションを作る | 303 で `next` へ。入れない → `/login?error=<code>`(`google_not_registered`・`google_failed`・`google_denied`)。結ぶとき → `/account?google=linked`、だめなら `?google=<code>`(`google_in_use`: 別の利用者に結ばれている) |

- `next` は同じオリジンの中の道(`/` で始まり `//` で始まらない)だけ。外の URL は `/` に置き換える
- Google の設定が無いのに `GET /session/google` を開いた → 303 で `/login?error=google_not_configured`

**アカウント**(ログイン中の本人。画面は 05 §15)

| メソッドとパス | 役割 | 応答 |
|---|---|---|
| `GET /account` | 自分のログインの状態 | `Account`: `has_password`、`password_changed_at`、`totp_enabled_at`(2 段階認証を設定した日時。まだなら null)、`google_email`(結んでいなければ null)、`recent_login`(このセッションが 10 分以内のログインか) |
| `PUT /account/password` | 本文 `{ current_password?, new_password }`。`current_password` は、10 分以内にログインしたセッションなら要らない(忘れたら Google で入り直して決める)。**通ったら、このセッション以外のセッションと、アプリの許可をすべて切る** | 204。短い・よく使われている・メールアドレスと同じ → 400 `weak_password`(理由の文)。いまのパスワードが要る → 400 `reauth_required`。違う → 400 `invalid_credentials`(ログインの間引きと同じ数えに入る) |
| `POST /account/totp` | 2 段階認証を(やり直して)設定し始める。新しい秘密を作り、設定中として持つ | `TotpSetup`。10 分以内のログインでない → 400 `reauth_required` |
| `PUT /account/totp` | 本文 `{ code }`。設定中の秘密で 6 桁が通ったら入れ替える(古い端末のコードは効かなくなる) | 204。違う → 400 `invalid_code`。外す口は無い(パスワードで入る限り必須) |
| `DELETE /account/google` | Google を外す | 204。パスワードを持っていない → 409 `last_login_method`(入る手段が無くなる) |
| `GET /account/sessions` | 自分のログイン中の端末(ブラウザのセッション)とアプリ(Android の許可) | `AccountSession[]`: `id`、`kind`(`browser` / `app`)、`label`(「Chrome · Windows」「Works · Android」。`User-Agent` とクライアントから作る)、`created_at`、`last_seen_at`、`current`(いま使っている端末か) |
| `DELETE /account/sessions/{id}` | 1 つ切る。自分のもの以外は 404 | 204 |
| `DELETE /account/sessions` | いま使っている端末以外を、すべて切る | 204 |

- `TotpSetup`: `secret`(base32。画面は 4 文字ずつ区切って見せる)、`otpauth_uri`(`otpauth://totp/…`。スマホで設定するとき、対応する認証アプリならこれを開いて登録できる)、`qr_svg`(`data:image/svg+xml,…`。画面は `<img>` で描く)
- Claude のコネクタ(`works` の許可)は、ここには出さない。これまでどおり環境設定の MCP で見る(§13)
- モックはこれまでどおりパスワードを確かめない(何を入れてもデモの利用者で入る)。`SessionOptions.google` は false。ログインの失敗・間引き・Google は、本物の API で確かめる(pytest と、E2E の http)

**管理者のコマンド**(画面は J-038)

```
python -m app.cli add-user <メール> [名前] [--admin]   利用者を足す。パスワードは持たない(Google で入るか、次で決める)
python -m app.cli set-password <メール>               パスワードを決める(標準入力から読む。画面に出さない)。その人のセッションと許可はすべて切れる
python -m app.cli reset-totp <メール>                 2 段階認証を消す(端末を無くした人のため)。次にパスワードで入るときに設定し直す
```

**エラーの符号**(ログインまわり): `unauthenticated`(401)、`invalid_credentials`(401。アカウントの画面では 400)、`too_many_attempts`(429)、`bad_origin`(403)、`invalid_code`・`weak_password`・`reauth_required`(400)、`login_expired`(401)、`last_login_method`(409)。Access の頃の `access_required`・`not_registered`・`access_login` は、切り替え(J-055)で無くなる。
