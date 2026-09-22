# META-017

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。取引先の現在の定義から画面と同じ全量の本文(readonly の列は含めない)を作り、項目(`fiscal_month`)を 1 つ足して `updateObject` に送ると、先頭の一覧ビューの列が「既存の列の並びのまま + 足した列 + `updated_at`」になることを確かめる。
  - `mocks/schema.ts` の `ensureViews` で足した列を `updated_at` の後ろへ置くように変えると落ちることを確認済み
