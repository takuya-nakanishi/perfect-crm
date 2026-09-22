# META-006

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。先頭の項目が `textarea`・`richtext`・`number`・`email`・`date` のテーブルで `createObject` が 400 を返し、テーブルが作られないこと、先頭が `text` なら作れて `name_field` がその列になり、`required` を付けずに送っても必須になること(2 番目以降の項目は必須にならないこと)を確かめる。先頭の型の検査を外すと落ち、先頭に必須を付ける処理を外しても落ちることを確認済み
