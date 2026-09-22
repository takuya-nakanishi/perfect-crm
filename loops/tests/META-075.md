# META-075

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追記。数値の項目(`headcount`、`scale: 0`)を持つテーブルを作って値を入れ、項目を外して保存したあと、同じ列名で参照型(参照先 accounts)を足すと `updateObject` が 400 で、`GET /meta` の定義も `table()` の行の値も変わらないことを確かめる。続けて同じ型(数値)で戻すと、保管していた定義のまま復活し、行の値もそのままであることを確かめる(400 のときに保管庫を捨てていない)
  - 期待値の確認: `schema.ts` の `buildField` で型の違いを弾く行(`existing.type !== input.type`)を無効にすると落ちる(`expected null to be 400`)ことを確認して戻した
