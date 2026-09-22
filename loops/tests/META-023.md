# META-023

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。テーブル(`trial`)を作ると、活動の関連先(`all_targets: true`)の `targets` が元の並びを保ったまま末尾に `trial` を 1 つ加えた形になり、`all_targets` の無いタスクの関連先(`accounts`・`opportunities`)は変わらないことを `getMeta()` で確かめる。
  - `mocks/schema.ts` の `createObject` で、`all_targets` の判定を外すと(タスクにも加わって)落ち、加える処理を止めると(活動に加わらず)落ちることを確認済み
