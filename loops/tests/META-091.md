# META-091

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追記。商談テーブルに一覧のビューを 2 つ作る。1 つは and の中に `close_date` の条件・`amount` の条件・or の群(`close_date` と `lead_source`)を並べたもの、もう 1 つは `close_date` を指す条件だけ(and の直下と、その中の or の群)のもの。`close_date` を外して `updateObject` すると、前者は `amount` の条件と `lead_source` だけの or の群が残り、後者は空になった群ごと条件が無くなる(ビューと列は残る)ことを `GET /meta` で確かめる。同じ列名・同じ型で戻すと、両方とも作ったときの定義に戻る
  - 期待値の確認: `schema.ts` の `cleanFilter` で無い項目の条件を外す部分を外すと落ちる(`expected { and: [ { …(3) }, …(2) ] } to deeply equal { and: [ …(2) ] }`)。空になった群を外す部分を外すと落ちる(`expected { and: [ { or: [] } ] } to be undefined`)。どちらも確認して戻した
