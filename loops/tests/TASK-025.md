# TASK-025

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。時計を固定し、未着手のタスクを `update('tasks', id, { status: 'done' })` で完了にしてから時計を進め、同じ `{ status: 'done' }` をもう一度送っても `completed_at` が最初の完了日時のまま(返り値も保存された行も)であることを確かめる。`applyRules` の `!wasDone` の条件を外す(done を送るたびに今で上書きする)変更で落ちることを確認済み
