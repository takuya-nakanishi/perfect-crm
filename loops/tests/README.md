# loops/tests — テストを書くキュー

テストケース表のうち、まだテストが無い行を 1 行ずつ実装するキュー。
キューの定義の読み方と、記録(`<ID>.md`)の書式は [`../README.md`](../README.md)。

| 項目 | このキューの値 |
|---|---|
| 名前 | `tests` |
| 1 件の単位 | テストケース表の 1 行(ID は `REC-004`・`META-010` など) |
| 索引 | `docs/tests/*.md`。「対応する資産」列が `—` の行が未実装、テストの名前が入っている行が実装済み |
| 取れる条件 | 未実装で、層が **L1・L2** の行。領域の順は meta → io → tasks → activities → records → settings(壊れたときの損失の順。`docs/tests/README.md` §1) |
| 成果物 | 対象ファイルの隣の `*.test.ts`(Vitest。`frontend/src/**`) |
| 触ってよいパス | 成果物のテストファイル(`frontend/src/**/*.test.ts`)、索引のその領域の表、`loops/tests/<ID>.md` の 3 つだけ |
| 合格条件 | `scripts/verify.sh` が green。索引の行にテストの名前が入っている。記録が `完了` になっている |
| 記録 | `loops/tests/<ID>.md` |
| 起動 | `scripts/loop-run.sh`(本体の作業ツリーのルートで実行する) |

## 取れない行

L3(実ブラウザの E2E `frontend/e2e/smoke.mjs`)・L4(PostgreSQL。まだ無い)・L5(公開 URL・実機)は取らない。
開発サーバ・Chromium・Access が要り、無人では確かめられない。人と、人が起こしたセッションが書く。

## 人がすること

`node scripts/loop-next.mjs --list` を実行し、「保留・取り下げ」に出た ID の記録を読む。原因に応じて次のどれかをする。

| 原因 | すること |
|---|---|
| 索引の行が誤り・曖昧 | `docs/tests/*.md` の行を直し、記録の `状態:` を `未着手` に戻す |
| 製品(モックの振る舞い・契約)の不具合 | `backlog/JOBS.md` に起票する。直したら `状態:` を `未着手` に戻す |
| そのテストは要らない | 記録の `状態:` を `取り下げ(日付): 理由` にする |
