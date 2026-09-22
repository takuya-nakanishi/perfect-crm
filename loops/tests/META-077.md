# META-077

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追記。参照先のテーブル(`plain`)と、それを relation で指す参照元のテーブル(`source`)を作り、`plain` を `deleteObject` したあと、`GET /meta` で見えている項目だけを本文に載せて `source` の名前だけ変えて `updateObject` する。名前は変わり、行の値はそのまま、`restoreObject('plain')` で relation の項目が同じ定義のまま戻る(隠れていた項目が外れていない)ことを確かめる
  - 期待値の確認: `schema.ts` の `updateObject` で隠れた項目を残す `hidden` を空にすると落ちる(`expected undefined to deeply equal { key: 'plain_id', … }`)ことを確認して戻した
