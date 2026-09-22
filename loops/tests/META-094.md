# META-094

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追記。活動テーブルに数値の項目 `minutes` を足し、`minutes` を指す部品(集計値・担当者ごとの棒)と関連先の `related_object` で分ける部品を持つレポート「混在」と、`minutes` を指す部品だけのレポート「所要分だけ」を作る。`minutes` を外して `updateObject` すると、「混在」は `related_object` の部品だけが残り、「所要分だけ」は `GET /meta` に出なくなる(ほかのビューは同じ並びで残る)。同じ列名・同じ型で戻すと、どちらも同じ定義で出ることを確かめる
  - 期待値の確認: `schema.ts` の `cleanView` で部品が 0 個なら外す判定(`widgets.length > 0 ? … : null`)を外すと落ちる(`expected { name: '所要分だけ', … } to be undefined`)。関連先の列を「ある列」とみなさないようにすると落ちる(`expected [ 'w-total', 'w-owner' ] to deeply equal [ 'w-total', 'w-owner', 'w-related' ]`)。どちらも確認して戻した
