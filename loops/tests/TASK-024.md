# TASK-024

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。時計を固定し、未着手のタスクを `update('tasks', id, { status: 'done', completed_at: 過去の日時 })` で完了にすると `completed_at` が渡した日時のまま(`updated_at` は今)、保存された行も同じであることを確かめる。`insert` で最初から `status: 'done'` + `completed_at` を渡した場合も同じ。対照として、完了日時を渡さない `insert`(done)は今になることも見る。`applyRules` の尊重の条件を外す(常に今で上書きする)変更で落ちることを確認済み
