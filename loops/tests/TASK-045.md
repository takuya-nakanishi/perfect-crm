# TASK-045

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。今日を 9/22 に固定し、repeat=weekly・期限 9/1(過去)・`repeat_from_completion`=真のタスクを `update('tasks', id, { status: 'done' })` で完了にすると、次回がちょうど 1 つでき期限が 9/29(完了した日 +7)になることを確かめる。比べる相手として、偽なら元の期限 +7 = 9/8 になることも確かめる。`applyRecurrence` で常に元の期限から数える変更で落ちることを確認済み
