# TASK-046

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。repeat=weekly・期限 9/22 のタスクに `update('tasks', id, { status: 'done' })` を 2 回送り、`repeat_of`=元の id の次回がちょうど 1 つ(1 回目と同じ行)で、行数が 1 件だけ増えることを確かめる。`applyRecurrence` の「既に次回があるなら作らない」を外すと 2 件になって落ちることを確認済み
