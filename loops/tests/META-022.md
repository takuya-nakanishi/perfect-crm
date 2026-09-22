# META-022

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。`in_sidebar` を送らずに作ったテーブル(`trial`)は true、`updateObject` に `in_sidebar: false` を入れて保存すると `getMeta()` で false、`in_sidebar` の無い本文で保存しても false のまま(既定の true に戻らない)、true で保存すると true、無い本文ではそのまま true であることを確かめる。
  - `mocks/schema.ts` の `updateObject` で、送られた値を無視して true にすると落ち、本文に無いときに true へ戻すようにしても落ちることを確認済み
