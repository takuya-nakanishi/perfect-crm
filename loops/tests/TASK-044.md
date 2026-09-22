# TASK-044

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。repeat=weekly・期限 9/22 のタスク(優先度 p1、ラベル 2 つ、関連先=商談、取引先責任者、担当=自分でない人)を `update('tasks', id, { status: 'done' })` で完了にし、元の行が done・期限 9/22 のまま残ること、行がちょうど 1 つ増え、`repeat_of`=元の id の次回が 1 つだけで、期限 9/29・status=open・`completed_at`=null、件名・優先度・関連先・責任者・担当・ラベル・繰り返しが写ることを確かめる。`applyRecurrence` で担当を写さない変更と、期限を進めない変更のそれぞれで落ちることを確認済み
