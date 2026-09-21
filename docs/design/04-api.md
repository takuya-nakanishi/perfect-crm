# 04 API の契約

画面とバックエンドのあいだの約束。**型の正は `frontend/src/api/types.ts`、振る舞いの正はモック(`frontend/src/mocks/engine.ts`)。**
この文書は、その 2 つを読まなくても全体が分かるための地図。食い違ったら型とモックが正しい。

バックエンド(J-021)はこの契約どおりに作る。画面側の実装は `frontend/src/api/http.ts` に既にある。

## 1. 約束ごと

- ベースは `/api/v1`。画面と同じオリジン(Caddy が `/api/*` を `api` へ流す)。認証はセッション Cookie
- JSON の列名は **DB の列名そのまま**(snake_case)。ID は UUID、日付は `YYYY-MM-DD`、日時は ISO 8601(UTC)、金額は円の整数
- 参照は ID で返し、表示名は応答の `references` に添える(§2)
- エラーは HTTP ステータス + `{ "code": "...", "message": "..." }`。未ログインは 401、無いレコードは 404、入力の不備は 400

## 2. エンドポイント

| メソッドとパス | 役割 | 応答 |
|---|---|---|
| `GET /session` | いまの利用者 | `Session`。未ログインは 401 |
| `POST /session` | ログイン(`email`・`password`) | `Session` |
| `DELETE /session` | ログアウト | 204 |
| `GET /meta` | テーブル・項目・ビュー・利用者の定義。起動時に 1 回 | `MetaResponse` |
| `POST /objects/{object}/records/query` | レコードの一覧(本文に `ListParams`) | `ListResponse` |
| `GET /objects/{object}/records/{id}` | 1 件 | `RecordResponse` |
| `POST /objects/{object}/records` | 作成(本文は列名 → 値) | `RecordResponse` |
| `PATCH /objects/{object}/records/{id}` | 更新(変える列だけ) | `RecordResponse` |
| `DELETE /objects/{object}/records/{id}` | 削除(論理削除) | 204 |
| `POST /objects/{object}/records/{id}/restore` | 削除の取り消し | `RecordResponse` |
| `POST /objects/{object}/aggregate` | 集計(本文に `AggregateParams`) | `AggregateResponse` |
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
- 値に書けるマクロ(**サーバが解決する**): `$today`、`$today+7`、`$today-30`、`$start_of_month`、`$end_of_month`、`$me`。「今日」は利用者のタイムゾーンでの今日
- NULL との大小比較は偽(SQL と同じ)。日時の列を日付と比べるときは、利用者のタイムゾーンでの日付に直してから比べる(UTC のまま比べると、朝の完了が前日扱いになる)
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

## 6. 書き込みの決まり

- `PATCH` は渡した列だけを変える。応答は、業務ルール(02 §3)を当てたあとの 1 行と、その参照先
- 作成時の既定値と、完了日時・確度の自動設定は**サーバの仕事**。画面は結果を受け取るだけ
- 画面は応答を待たずに表示を書き換え(楽観更新)、失敗したら元に戻して知らせる。応答が返ったら、関連する一覧・集計を読み直す

## 7. これから決めること

- ページング: いまは全件を返している(モックは数十件)。`limit` / `offset` は契約にあるが、画面は使っていない。数百件を超える前に、一覧の仮想スクロールと併せて入れる
- 変更の記録(誰が・いつ・何を)と、その参照 API
- MCP とチャットが使うコマンド層を、この HTTP API と同じ関数にどう揃えるか(03 §6・§7)
