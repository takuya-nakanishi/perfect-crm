# META-076

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追記。参照先のテーブル(`plain`)と、それを relation で指す参照元のテーブル(`source`)を作って値を入れ、`plain` を `deleteObject` すると `GET /meta` の `source` から relation の項目だけが消え(他の項目とテーブルは残り、行の値もそのまま)、`restoreObject` で項目が同じ定義のまま戻ることを確かめる
  - 期待値の確認: `schema.ts` の `liveObjects` で参照先が削除中の relation を外す filter を無効にすると落ちる(`expected true to be false`)ことを確認して戻した
