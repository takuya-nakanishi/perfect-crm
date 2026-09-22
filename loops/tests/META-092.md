# META-092

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追記。商談テーブルに、`close_date` を列・並び・条件で指す一覧と、カードの項目・並び・条件で指すカンバンを作る。`close_date` を外して `updateObject` したあと、画面(`data/views.ts` の `save`)と同じく `GET /meta` で受け取った定義から `id`・`object`・`position` を除き、名前だけ変えて `updateView` すると 400 にならず、名前が変わり定義は `GET /meta` で見えていたまま(一覧の列は `name`・`stage`、カンバンのカードは `amount`)であることを確かめる
  - 期待値の確認: `schema.ts` の `cleanView` で一覧の列から無い項目を外す部分を外すと落ちる(`expected 400 to be null`)。カンバンのカードの項目から外す部分を外しても同じく落ちる。どちらも確認して戻した
