# META-071

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追記。`GET /meta` で `system` の付いたテーブル(fixtures の全件。`accounts` を含む)をそれぞれ `deleteObject` すると 400 で、`GET /meta` に残ることを確かめる。400 が `system` によるものだと分かるよう、作ったばかりの `system` でないテーブルは同じ経路で消せることも確かめる
  - 期待値の確認: `schema.ts` の `system` の判定を一時的に外すと `accounts: expected null to be 400` で落ちることを確認して戻した
  - 気づき(このケースの範囲外): `docs/design/02` の `system` の説明が、表では「4 つ」、§ の決まりでは「5 つ」と食い違っている(fixtures は 5 件)
