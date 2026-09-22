# META-074

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追記。商談テーブルから `close_date`(`semantic: deadline`)・`primary_contact_id`(参照先 contacts)・`type`(選択肢、`in_create_form: false`)を外して `updateObject` すると `GET /meta` から消えるが、`table()` の行の値は変わらないことを確かめる。続けて同じ列名・同じ型で戻す(ラベルを変え、参照先は accounts を送り、`semantic`・`in_create_form` は送らず、選択肢は 2 つに減らして名前と色を変える)と、ラベルと選択肢は本文のもの、参照先・`semantic`・`in_create_form` は保管していた定義のものになり、行の値もそのままであることを確かめる
  - 期待値の確認: `schema.ts` の `updateObject` で保管庫(`removed[f.key]`)から既存の定義を引く部分を外すと落ちる(`expected { key: 'close_date', …(2) } to deeply equal { key: 'close_date', …(3) }`)ことを確認して戻した
