# TASK-005

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。`insert('tasks', …)` で、件名を省く・null・空文字、関連先がテーブル名だけ・ID だけ、`targets`(accounts・opportunities)外のテーブル(実在する contacts・tasks の ID を添えたもの、無いテーブル名)のどれも 400 で、行が増えないことを確かめる。境界として、targets 内のテーブルと ID の組、および関連先なしは通ることも見る。件名の必須判定を外す・targets の判定を外す・両方 null の素通しを外す変更で、それぞれ落ちることを確認済み。「組で指定」の判定だけを外しても、片方だけの値は後段(targets に null は無い / ID が null の行は無い)で 400 になるため落ちない(契約の 400 は保たれる)
