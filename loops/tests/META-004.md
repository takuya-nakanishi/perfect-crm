# META-004

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。列名 `Deals`・`deal_X`・`1deals`・`_deals`・41 文字で `createObject` が 400 を返し、テーブルが増えないこと、40 文字ちょうどは作れることを確かめる。`KEY_PATTERN` を緩めると落ちることを確認済み
