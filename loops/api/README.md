# loops/api — バックエンドを実装するキュー

テストケース表の **L2 の行**(モックのエンジン = サーバの振る舞いの正)を 1 行ずつ、本物の HTTP API に向けて確かめ、
落ちたら実装を足すキュー。キューの定義の読み方と、記録(`<ID>.md`)の書式は [`../README.md`](../README.md)。

**まだ回せない。**足場(J-021・J-022)が済むまで起動しない。条件は下の「回せるようになる条件」。

| 項目 | このキューの値 |
|---|---|
| 名前 | `api` |
| 1 件の単位 | テストケース表の **L2 の行 1 つ**(ID は `REC-004`・`META-010` など。`tests` キューと同じ行を、別の層から見る) |
| 索引 | `docs/tests/*.md` の **「API の資産」列**(`tests` キューが使う「対応する資産」列の隣に足す)。`—` が未実装、pytest のファイル名が入っていれば実装済み |
| 取れる条件 | 層が **L2** で、「API の資産」が `—` の行。領域の順は meta → io → tasks → activities → records → settings(`docs/tests/README.md` §1) |
| 成果物 | `backend/tests/**` の pytest 1 件(名前は `test_<ID>_…`)と、**それを通すために足りなかった `backend/app/**` の実装** |
| 触ってよいパス | `backend/**`、索引のその領域の表(その行だけ)、`loops/api/<ID>.md` の 3 つだけ。**`frontend/**` と `docs/design/**` は変更したら不合格**(契約を書き換えて通すのを防ぐ) |
| 合格条件 | `scripts/verify.sh` が green(`backend:lint`・`backend:types`・`backend:test` を含む)。**既存の pytest が 1 件も落ちない**。索引の行に pytest のファイル名が入り、記録が `完了` になっている |
| 記録 | `loops/api/<ID>.md` |
| 起動 | `scripts/loop-run.sh --queue api`(本体の作業ツリーのルートで実行する) |

## `tests` キューとどこが違うか

`tests` キューは「製品のコードに触ったら不合格」で安全を買っていた。このキューは**製品のコード(バックエンド)そのものを書く**ので、
その守りが使えない。代わりに 2 つで守る。

1. **契約と、既に緑のテストに触らせない。**`frontend/**`(型・モック・Vitest)と `docs/design/**` を触れないので、期待値を緩めて通すことができない
2. **毎周、既存の pytest を全部回す。**1 件を通すために別の行を壊せば、その周が不合格になる

## 期待する 1 周の形

足場(J-021)で 04 の全エンドポイントを一通り実装してからこのキューを開く。だから多くの行は、
**pytest に写すだけで通る**(実装済みの経路を別の入力で叩くだけ)。落ちた行だけが実装の追加になる。
1 周が「表の 1 行を pytest に写す → 落ちたら `backend/app/**` を直す → verify が green」で閉じる大きさに保つのが、このキューの狙い。

期待値の出どころは 3 つ。**食い違ったらこの順で正しい。**

1. 表の行の文(`docs/tests/*.md`)
2. 同じ ID の Vitest(`frontend/src/mocks/*.test.ts`。モックの振る舞いが正 — `docs/design/03` §3)
3. 契約(`docs/design/04`、`frontend/src/api/types.ts`)

3 つが食い違っていたら、テストを書かずに記録を `保留` にして、どう食い違っているかを書く(人が直す)。

## 回せるようになる条件(足場。J-021・J-022)

- `backend/` が動く(uv・FastAPI・設定・DB セッション・`{code, message}` のエラー・Alembic の初期リビジョン)
- **メタデータから SQL を組む層**が通っている(フィルタの真理値表・並び・集計。`docs/design/08` §3 の 2)。ここをループに探させると周ごとに設計がバラけるので、人が先に 1 本通す
- 論理削除の一括適用、polymorphic の書き込み検証、検索の正規化列 + `pg_trgm`(同 §3 の 3〜5)
- pytest の土台(Compose の `db` に対して、1 テスト 1 トランザクションでロールバック)
- `scripts/verify.sh` に `backend:lint`・`backend:types`・`backend:test` が入っている
- `scripts/loop-run.sh` と `loop-next.mjs` が `--queue` を受ける(いまは `tests` 固定)
- 索引に「API の資産」列があり、`loop-next.mjs --check` が pytest 側の ID も検査する

## 人がすること

`node scripts/loop-next.mjs --queue api --list` の「保留・取り下げ」に出た ID の記録を読む。`tests` キューと同じ扱いだが、
**「設計が要る」で保留になった項目は、人が足場側に手を入れてから解除する**(ループに設計させない)。
