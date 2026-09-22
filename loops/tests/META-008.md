# META-008

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。`createObject` で作ったテーブルの項目が、入れた項目の後ろに `created_at`・`updated_at`(datetime・readonly)が付いた並びになること、入れた項目は readonly でないこと、`position` が既存のどのテーブルより大きく、続けて作ったテーブルはさらに後ろになること、`in_sidebar` が既定で true、`false` を渡せば false になることを確かめる。`in_sidebar` の既定を false にする・システムの列の readonly を外す・`position` を末尾にしない、のどれでも落ちることを確認済み
