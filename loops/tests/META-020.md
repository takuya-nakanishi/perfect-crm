# META-020

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。選択肢の項目が無いテーブル(`trial`)を作るとカンバンが 0 枚、`updateObject` で選択肢の項目(`stage`)を初めて足すと `group_by: stage` のカンバンが 1 枚でき、さらに選択肢の項目(`rank`)を足しても同じ 1 枚のまま(id と `group_by` も変わらない)ことを確かめる。
  - `mocks/schema.ts` の `ensureViews` で既存のカンバンの有無を見ないようにすると 2 枚になって落ち、カンバンを作らないようにすると 0 枚で落ちることを確認済み
