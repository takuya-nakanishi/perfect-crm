# META-021

- 状態: 完了(2026-09-22)
- 経緯: 保留(2026-09-22)の理由は下。製品を直したので未着手に戻した: 選択肢の `kind` を本文に書かずに保存すると、モックが `kind`(と `probability`)を落とす。`docs/design/04-api.md` §「テーブルの定義」(106 行目)の「選択肢の `kind` など、ここに書けない属性は元のまま保つ」と食い違う製品側の不具合

## 試行の記録

- [2026-09-22] 保留: 製品側の修正が要る
  - 確かめたこと: `updateObject('opportunities', …)` に、画面が送るのと同じ全量の本文から `semantic`・`in_create_form`・選択肢の `kind`/`probability` を除き(選択肢は `value`・`label`・`color` だけ)、フェーズの `label` だけを変えて送った
  - 結果: `close_date` の `semantic: 'deadline'` と `type` の `in_create_form: false` は保たれた。フェーズ(`stage`)の選択肢からは `kind`(open / won / lost)と `probability` が消えた
  - 原因: `frontend/src/mocks/schema.ts` の `buildField` が `field.options = options`(本文の選択肢)で丸ごと置き換え、既存の選択肢(同じ `value`)の `kind`・`probability` を引き継いでいない
  - 補足: いまの画面(`lib/tableDraft.ts` の `toInput`)は選択肢を `{ ...o }` で送るので `kind` は残る。MCP・AI チャットなど、本文に `kind` を書かない経路で落ちる
  - 直ったら `状態:` を `未着手` に戻せば、上の手順でテストを書ける
- [2026-09-22] 人が製品を直した(`schema.ts` の `buildField`: 同じ `value` の既存の選択肢から `kind`・`probability` を引き継ぐ)。`未着手` に戻す
- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` の「META-021 …」
  - 商談へ、選択肢を `value`・`label`・`color` だけにした全量の本文でテーブル名・フェーズ名・選択肢名を変えて保存し、`close_date` の `semantic`、`type`・`probability` の `in_create_form: false`、フェーズの選択肢の `kind`・`probability` が元のままであることを確かめた
  - 守りの確認: `schema.ts` の `buildField` で既存の選択肢を引き継がないようにすると落ちる(確かめて戻した)
