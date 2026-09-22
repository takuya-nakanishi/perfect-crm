# META-012

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。数値(`number`)の項目を持つテーブルを作り、`updateObject` でその項目の型を `text`・`textarea`・`percent`・`date`・`email` に変えると 400 を返し、型が `number` のまま、同じ本文のテーブル名の変更も残らないことを確かめる。型を変えない同じ本文なら更新できることも確かめる。`mocks/schema.ts` の `buildField` の型の検査を外すと落ちることを確認済み
