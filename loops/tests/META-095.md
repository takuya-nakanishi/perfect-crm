# META-095

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追記。取引先(`subtitle_field` は `industry`)で、先に別の項目(`phone`)だけを外しても `subtitle_field` が残ることを見てから、`industry` を外して `updateObject` する。`GET /meta` の `subtitle_field` が消え(`name_field` はそのまま)、`refOf` と `searchAll` の添え字(外す前は「製造」)が `null` になることを確かめる
  - 期待値の確認: `schema.ts` の `updateObject` で無い項目を指す `subtitle_field` を消す行を外すと落ちる(`expected 'industry' to be undefined`)。確認して戻した
