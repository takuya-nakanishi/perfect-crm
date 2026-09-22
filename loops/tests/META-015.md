# META-015

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追加。タスク・活動の現在の定義から画面と同じ全量の本文(readonly の列は含めない)を作り、タスクの `status`、活動の `subject`・`type`・`occurred_on`・`body` を 1 つずつ外して `updateObject` に送ると 400 になり、項目の並びもテーブル名も元のまま残ることを確かめる。守られていない項目(タスクの `description`)なら外せることも確かめる。
  - `completed_at` は readonly(システムが埋める列)で、画面は本文に入れない(`lib/tableDraft.ts`)。そのため「外す」本文は通常の保存と同じ形になり、400 にはならない。行の「→ 400」はこの列には当てはまらないと読み、「無い本文を送っても外れずに残る」ことを確かめた(`docs/design/02` §5「`readonly` … は外せない」と整合)。行の文言を直すかは人の判断
  - `mocks/schema.ts` の `isProtectedField` から `timeline` の条件を外すと落ちる、`updateObject` の `editable` から readonly の除外を外すと落ちることを確認済み。`completion.field` の条件だけを外しても、状況の列が無い本文は後段の「`done` / `open` の選択肢は消せない」検査で 400 になるため落ちない(二重の守り)
