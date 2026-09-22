# TASK-047

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。repeat=weekly のタスクを done にして次回ができたあと open に戻すと、`repeat_of`=元の id の次回が消えて行数が元に戻ることを確かめる。別のタスクで次回を先に done にしてから元を open に戻すと、次回は done のまま残ることを確かめる。どちらの期待値を反転させても落ちることを確認済み
