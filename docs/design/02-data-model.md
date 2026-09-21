# 02 データモデル

画面が読む形(メタデータとレコード)と、それを PostgreSQL にどう置くかの案。
**いま動いているのはモックだけ**で、正は `frontend/src/mocks/fixtures/*.json`(DB の行と同じ形)と `frontend/src/api/types.ts`(型)。
PostgreSQL のスキーマは J-022 で確定する。§4 はそのための下書き。

## 1. 考え方

1. **定義もデータ。**テーブル(`objects`)・項目(`fields`)・ビュー(`views`)の定義をメタデータとして持ち、画面はそれを読んで描く(01 D-01)
2. **レコードは「DB の 1 行」そのまま。**列名は snake_case、ID は UUID、日付は `YYYY-MM-DD`、日時は ISO 8601(UTC)。画面は camelCase に直さない。変換の層を挟まないので、API の返り値をそのまま差し込める
3. **参照は ID で持ち、表示名はサーバが添える。**レコードには `account_id` だけが入り、一覧の応答に `references`(テーブル名 → ID → 表示名)が付く。SQL でいう JOIN を画面にやらせない
4. **業務ルールはサーバ側。**「完了にしたら完了日時を入れる」「フェーズを変えたら確度を既定値にする」は、画面ではなくサーバ(いまはモックの `applyRules`)が行う。画面・MCP・AI チャットのどこから書いても同じ結果になる

## 2. メタデータ

### objects(テーブルの定義)

| 列 | 意味 |
|---|---|
| `key` | テーブル名。URL(`/o/accounts`)と API のキーにも使う |
| `label` / `icon` / `color` | 表示名、lucide のアイコン名、色(タグと同じ 9 色) |
| `name_field` | レコードの表示名に使う列(取引先なら `name`、タスクなら `title`) |
| `subtitle_field` | 検索結果などで名前に添える列(任意) |
| `position` / `in_sidebar` | サイドバーの並びと、出すかどうか |
| `completion` | チェックで完了にできるテーブルの設定(`field`・`done_value`・`open_value`・`completed_at_field`)。いまはタスクだけ |
| `fields` | 項目の定義(下) |

### fields(項目の定義)

| 型 | 中身 | 備考 |
|---|---|---|
| `text` `textarea` `email` `phone` `url` | 文字 | 検索の対象 |
| `number` `currency` `percent` | 数値 | `currency` は円。一覧の下に合計が出る |
| `date` `datetime` | 日付、日時 | `semantic: "deadline"` を付けると締め切りとして扱い、過ぎていてレコードが終わっていなければ注意色 |
| `select` | 選択肢 | `options` に `value`・`label`・`color`。カンバンの列になる。選択肢に `kind`(open / won / lost / done)と `probability` を持てる |
| `checkbox` | 真偽 | |
| `relation` | 別テーブルへの参照(`target`) | 列 = `key`(例 `account_id`) |
| `polymorphic` | 複数テーブルのどれかへの参照(`targets`) | 列は 2 本(`columns.object` にテーブル名、`columns.id` に ID)。タスクの関連先 |
| `user` | 利用者への参照 | |

共通の属性: `required`、`readonly`(システムが埋める列)、`in_create_form`(新規作成フォームに出すか)、`placeholder`。

### views(ビューの定義)

1 テーブルに何枚でも持てる。画面のタブはこの並び(`position`)。`pin` を付けるとサイドバーの「お気に入り」に出る(`show_count` で件数付き)。

| 型 | `config` |
|---|---|
| `list` | `columns`(列と幅の比)、`filter`、`sort` |
| `kanban` | `group_by`(選択肢の列)、`card_fields`、`sum_field`(列見出しの合計)、`hidden_groups`(出さない列。完了済みなど)、`filter`、`sort` |
| `report` | `widgets`。`stat`(数字 1 つ。`denominator_filter` で割合、`secondary` で補足、`tone: alert` で注意色)と、`bar` / `column`(`group_by`・`measure`・`color`・`order`・`limit`・`wide`) |

フィルタ・並び・集計の書き方は 04 §3〜§5。

## 3. テーブル(初回ローンチの 4 つ + 利用者)

全テーブル共通: `id`(UUID)、`created_at`、`updated_at`。以下は主な列。全量は `fixtures/objects.json`。

| テーブル | 主な列 |
|---|---|
| **accounts** 取引先 | `name`(必須)、`name_kana`、`type`(見込み客 / 顧客 / パートナー / その他)、`industry`、`phone`、`website`、`prefecture`、`address`、`employees`、`owner_id`、`description` |
| **contacts** 取引先責任者 | `name`(必須)、`name_kana`、`account_id`(任意。所属の無い人も持てる)、`department`、`title`、`email`、`phone`、`role`(決裁者 / 推進役 / 窓口 / 技術担当 / 経理 / その他)、`status`(関係: 新規 / やり取り中 / 定期フォロー / 休眠)、`last_contacted_on`、`owner_id`、`description` |
| **opportunities** 商談 | `name`(必須)、`account_id`(必須)、`primary_contact_id`、`stage`(見込み → ヒアリング → 提案 → 見積 → 交渉 → 受注 / 失注。選択肢に確度の既定値と open / won / lost)、`amount`、`probability`、`close_date`(締め切り)、`type`、`lead_source`、`next_step`、`owner_id`、`description` |
| **tasks** タスク | `title`(必須)、`status`(未着手 / 進行中 / 相手待ち / 完了)、`priority`(P1〜P4。色は Todoist と同じ赤・橙・青・灰)、`due_date`(締め切り)、`related_object` + `related_id`(関連先: 取引先か商談)、`contact_id`、`assignee_id`、`description`、`completed_at` |
| **users** 利用者 | `name`、`email`、`avatar_color`。サイドバーには出さない |

関連リスト(レコードのパネルの下半分)は定義しない。**メタデータから「このテーブルを参照している列」を探して自動で出す**(取引先を開くと、取引先責任者・商談・タスクが並ぶ)。テーブルが増えれば関連リストも増える。

### サーバ側の業務ルール(いまはモックの `applyRules`)

- `completion.field` を `done_value` にしたら `completed_at` に現在時刻。戻したら NULL
- 商談の `stage` を変えたら、`probability` をそのフェーズの既定値にする(同時に確度を指定したときは尊重)
- 作成時の既定値: 必須の選択肢は先頭の値、`user` 型は自分、タスクの優先度は P4
- 更新のたびに `updated_at`

## 4. PostgreSQL への置き方(下書き。J-022 で確定)

- 4 つのテーブルは**ふつうの実テーブル**にする(列に型と制約が付き、集計が素直な SQL で書ける)。`relation` は FK、`select` は `text` + メタデータでの検証(選択肢を変えるたびに ALTER TYPE しないため、enum 型は使わない)
- メタデータは `meta_objects` / `meta_fields` / `meta_views` の 3 表。`options` と `config` は JSONB
- `polymorphic` は FK を張れない。`related_object` は `meta_objects.key` への FK、`related_id` は検証をアプリ側で行い、参照先を消すときに掃除する
- 検索は `pg_trgm`(規模が小さいので足りる)。ひらがな・カタカナ・全角半角の正規化は、検索用の列を 1 本持って吸収する
- 削除は論理削除(`deleted_at`)。画面の「元に戻す」はこれを外すだけ(API は `POST …/restore`)
- ID は UUID v7(時系列順に並ぶ)

**ローンチ後にテーブルを画面から追加できるようにする(J-031)とき、レコードをどこに置くか**は未決 → **Q-036**。
実テーブルを DDL で作る案と、汎用の 1 表 + JSONB に入れる案があり、J-022 のスキーマとバックエンドのフレームワーク選定(Q-034)に効く。

## 5. モックのデータ

- `frontend/src/mocks/fixtures/` に、メタデータ(`objects.json`・`views.json`。手で書く)とレコード(`accounts.json` ほか。`npm run fixtures` で生成)を置く。会社・人物は架空、メールは `example.jp`、電話は実在しない局番
- レコードの日付は生成時の基準日で書かれており、モックが読み込むときに「今日」基準へずらす。いつ開いても、今日のタスクと今月の商談がある
- 画面での変更は localStorage に残る。利用者メニューの「モックのデータを初期化」で戻せる
