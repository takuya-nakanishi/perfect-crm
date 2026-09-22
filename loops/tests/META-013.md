# META-013

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。参照先が `accounts` の参照の項目を持つテーブルを作り、`updateObject` で参照先を `contacts`(生きている別のテーブル)・`no_such_table`・空に変えた本文を送っても、参照先は `accounts` のまま保たれ、同じ本文のテーブル名の変更は通ることを確かめる(モックは 400 にせず、既存の参照先を黙って引き継ぐ)。`mocks/schema.ts` の `buildField` の既存の参照先を引き継ぐ分岐を外すと落ちることを確認済み
