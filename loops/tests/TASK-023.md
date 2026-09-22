# TASK-023

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。時計を固定して未着手のタスクを作り、時計を進めて `update`(status → done)すると `completed_at` と `updated_at` がその時刻になること、さらに進めて open に戻すと `completed_at` が null になり `updated_at` がその時刻になることを、返り値と保存された行の両方で確かめる。`applyRules` の「戻したら null」を外す・`updated_at` の更新を外す・完了日時に今を入れるのをやめる、の各変更で落ちることを確認済み
