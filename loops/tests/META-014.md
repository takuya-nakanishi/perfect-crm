# META-014

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。商談(`opportunities`)の現在の定義から全量の本文を作り、表示名の項目(`name`)または `locked` の項目(`stage`、フェーズ)だけを外して `updateObject` に送ると 400 になり、項目の並びもテーブル名も元のまま残ることを確かめる。守られていない項目(`amount`)なら同じ形の本文で外せることも確かめる。`mocks/schema.ts` の `isProtectedField` から `field.locked` の条件、`name_field` の条件をそれぞれ外すと落ちることを確認済み
