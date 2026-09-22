# TASK-026

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。未着手のタスクを `update('tasks', id, { status: 'waiting' })`(相手待ち)にしても `completed_at` が null のまま、完了にしたタスクを相手待ちへ移すと `completed_at` が null になること(返り値も保存された行も)を確かめる。`applyRules` の `if (!isDone) next[c.completed_at_field] = null` を外す変更で落ちることを確認済み
