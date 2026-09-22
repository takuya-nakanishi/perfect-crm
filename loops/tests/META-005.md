# META-005

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。列名 `users`・`meta`・`session`・`search` で `createObject` が 400 を返し、テーブルの数が変わらないこと、予約語を含むだけの `users_extra` は作れることを確かめる。`RESERVED_OBJECT_KEYS` から `search` を外すと落ちることを確認済み
