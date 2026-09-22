# META-073

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追記。`system` でないテーブルを作ってレコードを 1 件入れ、`deleteObject` したあとに同じ列名(ラベルと項目は別のもの)で `createObject` すると 400 になり、`GET /meta` に出ず、`table()` のレコードも上書きされないことを確かめる。続けて `restoreObject` で、削除前の定義とレコードがそのまま戻ることを確かめる
  - 期待値の確認: `schema.ts` の `createObject` で削除済みの同名テーブルを弾く行を外すと落ちる(`expected null to be 400`)ことを確認して戻した
