# META-011

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。文字(`text`)の項目の `max_length` が 0・100001 のとき、数値(`number`)の項目の `scale` が 7 のときに `createObject` が 400 を返し、テーブルが作られないことを確かめる。境界の `max_length` 1・100000 と、`scale` 1〜6 は保存され、定義に値がそのまま残ることも確かめる。`mocks/schema.ts` の検査を `scale > 7` に緩めた場合と、`max_length < 0` に緩めた場合の両方で落ちることを確認済み
