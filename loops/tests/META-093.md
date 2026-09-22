# META-093

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追記。商談テーブルに選択肢の項目 `rank` を足し、それで分けるカンバンを作る。`rank` を外して `updateObject` すると、そのカンバンだけが `GET /meta` に出なくなり(ほかのビューは同じ並びで残る)、同じ列名・同じ型で戻すと同じ定義で出ることを確かめる
  - 期待値の確認: `schema.ts` の `cleanView` で `group_by` が無いカンバンを外す行(`if (!has(view.config.group_by)) return null`)を外すと落ちる(`expected { Object (name, type, ...) } to be undefined`)。確認して戻した
