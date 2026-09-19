# 02 データモデル

## 1. 原則

1. **全ドメインテーブルに `organization_id`。**RLS のポリシーは `organization_id = current_setting('app.organization_id')::uuid`。アプリ用 DB ロールは BYPASSRLS を持たない。マイグレーションは別ロールで流す
2. **supertype `records`。**企業・担当者・リード・案件・プロジェクト・タスク・活動の各行は、同じ id で `records` にも 1 行持つ(class table inheritance)。レコード間の関係・監査・外部ファイルはすべて `records` を指すので FK が効く
3. **`records` への参照は `(organization_id, id)` の複合 FK。**`records` に `UNIQUE (organization_id, id)` を置き、`record_links`・`audit_log`・`external_files`・各エンティティ表の PK など、`records` を指す列はすべて `(organization_id, record_id)` の組で参照する。理由: FK 検査は RLS を迂回するので、id 単独の FK では組織 A の行が組織 B の `records.id` を指せてしまう
4. **関係は `record_links`。**何と何でも結べる(役割付き)。所属(企業↔担当者)だけは属性(部署・役職・期間)を持つので専用テーブル
5. **カスタム項目は JSONB。ただし関連型は除く。**定義は `custom_field_definitions`(組織スコープ)、値は各テーブルの `custom`。**関連型の値だけは `custom` に入れず `record_links` に `role = 'custom:<key>'` で持つ**(JSONB の中の id には FK が付かないため)
6. **書き込みは全部監査される。**`audit_log` に before / after と actor。リビジョン(元に戻す)はここから
7. ID は UUID v7(時系列順)。時刻は `timestamptz`。削除は `records.deleted_at`(論理削除、既定で非表示)

## 2. 図

```mermaid
erDiagram
  organizations ||--o{ records : owns
  records ||--o| companies : is
  records ||--o| contacts : is
  records ||--o| leads : is
  records ||--o| deals : is
  records ||--o| projects : is
  records ||--o| tasks : is
  records ||--o| activities : is
  records ||--o{ record_links : from
  records ||--o{ record_links : to
  companies ||--o{ company_contacts : has
  contacts ||--o{ company_contacts : has
  contacts ||--o{ contact_identities : has
  deal_stages ||--o{ deals : stage
  projects ||--o{ tasks : contains
  projects ||--o{ sections : has
  sections ||--o{ tasks : groups
  records ||--o{ record_labels : tagged
  labels ||--o{ record_labels : on
  records ||--o{ external_files : has
  records ||--o{ audit_log : logs
  organizations ||--o{ custom_field_definitions : defines
```

## 3. テーブル

共通列(全ドメインテーブル): `id uuid`、`organization_id uuid`、`created_at`、`updated_at`。以下は要点の列だけ。

### テナントと利用者

| テーブル | 要点 |
|---|---|
| `organizations` | Better Auth(候補)の organization プラグインが持つ。ドメイン側は id を参照するだけ。組織の設定(`document_sharing` 等)は `organization_settings` に別途持つ |
| `users` / `members` / `sessions` / `accounts` | 同上。`accounts` に Google のトークンが載る(保存時に暗号化) |
| `api_tokens` | Better Auth(候補)の apiKey プラグイン。利用者・組織ごと。MCP の認証に使う |

### supertype

| テーブル | 要点 |
|---|---|
| `records` | `type`(company / contact / lead / deal / project / task / activity)、`display_name`、`search_text`(名前・カナ・メール等を連結した検索用)、`deleted_at`、`created_by_user_id`。`UNIQUE (organization_id, id)` |

### 顧客管理

| テーブル | 要点 |
|---|---|
| `companies` | `name`、`name_kana`、`name_normalized`(前株/後株・表記ゆれを落とした重複判定キー)、`corporate_number`(法人番号、組織内で一意・任意)、`website`、`phone`、`postal_code`、`prefecture`、`city`、`address1`、`address2`、`industry`、`owner_user_id`、`external_ids jsonb`(会計サービスの取引先 ID 等)、`notes`、`custom jsonb` |
| `contacts` | `last_name`、`first_name`、`last_name_kana`、`first_name_kana`、`title`、`owner_user_id`、`notes`、`custom`。**主所属の列は持たない**(正本は `company_contacts.is_primary` だけ) |
| `company_contacts` | `company_id`、`contact_id`、`is_primary`、`department`、`title`、`started_on`、`ended_on`、`note`。**主所属の正本はここ。**部分一意インデックス `(contact_id) WHERE is_primary AND ended_on IS NULL` で在籍中の主所属を 1 行に限る。転職は行を閉じて(`ended_on`)新しい行を足す。所属の変更は `setAffiliation` コマンド経由のみ |
| `contact_identities` | `contact_id`、`kind`(email / phone / line / whatsapp / other)、`value`、`normalized_value`、`is_primary`。一意なのは `(contact_id, kind, normalized_value)` だけで、**組織内では一意にしない**(代表電話や共有メールを複数の担当者が持つため)。受信した連絡から担当者を引くときは候補を複数返す |

### 案件管理

| テーブル | 要点 |
|---|---|
| `leads` | `status`(new / working / qualified / converted / disqualified)、`source`、`company_name`、`contact_name`、`email`、`phone`、`message`、`raw jsonb`(受け取った生データ)、`owner_user_id`、`converted_company_id`、`converted_contact_id`、`converted_deal_id`、`converted_at`、`disqualified_reason`、`custom` |
| `deal_stages` | `name`、`position`、`probability`、`kind`(open / won / lost)。組織ごとに設定。初期値は 初回接触 → 提案 → 見積 → 交渉 → 受注 / 失注 |
| `deals` | `name`、`company_id`(必須)、`stage_id`、`amount numeric`(JPY 総額。明細は持たない。見積・請求は perfect-crm で持たない、Q-026)、`expected_close_on`、`closed_at`、`lost_reason`、`owner_user_id`、`custom`。担当者(決裁者・窓口)は `record_links` の role で |

### プロジェクト管理

| テーブル | 要点 |
|---|---|
| `projects` | `name`、`company_id`(任意)、`deal_id`(任意。**案件とは別エンティティ**で、1 案件から複数のプロジェクトを起こせる)、`status`(planned / active / on_hold / done / cancelled)、`starts_on`、`ends_on`、`owner_user_id`、`description`、`custom` |
| `tasks` | `title`、`description`、`status`(todo / doing / done / cancelled)、`priority`(1〜4)、`starts_on`、`due_on`、`due_at`(任意)、`assignee_user_id`、`project_id`(任意)、`section_id`(任意)、`parent_task_id`(任意)、`recurrence`(RRULE 文字列、任意)、`completed_at`、`position`、`custom`。**`project_id` が NULL のタスクがインボックス**(Todoist の代わりとして素早く放り込む先) |
| `sections` | `project_id`、`name`、`position`。プロジェクト内の区分。カンバンの列にもなる。`project_id` が NULL のセクションはインボックス内の区分 |
| `labels` | `name`、`color`、`position`。組織で共有。タスク以外にも付けられるよう `record_labels` で持つ |
| `record_labels` | `record_id`、`label_id`。`(organization_id, record_id, label_id)` 一意 |

### 横断

| テーブル | 要点 |
|---|---|
| `activities` | `kind`(note / call / meeting / email / line / whatsapp / system)。**レコードに関連する活動だけ**(01 D-12)。`meeting` は対面と Web 会議の両方、`direction`(inbound / outbound / none)、`occurred_at`、`subject`、`body`(Markdown)、`source`(ui / mcp / import / system)、`external_ref jsonb`(Gmail の messageId / threadId 等)、`actor_user_id`、`actor_agent`、`custom`。関連先は `record_links` |
| `record_links` | `from_record_id`、`to_record_id`、`role text NOT NULL DEFAULT 'related'`(決裁者・窓口・`custom:<key>` 等)。`UNIQUE (organization_id, from_record_id, to_record_id, role)`。role を NULL にしない理由: PostgreSQL の UNIQUE は NULL 同士を区別するので重複を防げない。両方向から引く |
| `external_files` | `record_id`、`provider`(google_drive)、`kind`(doc / sheet / slide / file)、`origin`(created / linked)、`external_id`(Drive の file id。URL 貼り付けだけの場合は null)、`mime_type`、`url`、`title`、`created_by_user_id`。1 レコードに複数 |
| `google_drive_folders` | `user_id`、`key`(root / 各エンティティ / record)、`record_id`(key が record のとき)、`folder_id`。名前で探さないための台帳。マイドライブなので利用者ごとに持つ |
| `custom_field_definitions` | `record_type`、`key`、`label`、`type`(text / number / date / select / multi_select / relation / url)、`options jsonb`、`relation_target_type`、`required`、`position`。relation 型の値は `record_links`(§1-5) |
| `organization_settings` | `document_sharing`(members / group:<address> / domain:<domain> / none。既定 members)など組織単位の設定 |
| `audit_log` | `record_id`、`action`(create / update / delete / link / unlink)、`actor_user_id`、`actor_agent`、`via`(ui / mcp / api / import / system)、`evidence jsonb`(根拠: 元メール ID 等)、`before jsonb`、`after jsonb` |

## 4. 重複判定

作成コマンドは既定で重複候補を探し、見つかれば作らずに候補を返す(呼び手が `allowDuplicate: true` を付けるか、既存 id を選ぶ)。**判定は候補を返すだけで、DB の一意制約にはしない**(共有の電話・メールが実在するため)。

| 対象 | 鍵 |
|---|---|
| 企業 | `corporate_number` 完全一致 / `name_normalized` 完全一致 / `name` の trigram 類似 |
| 担当者 | `contact_identities`(email・phone)の一致を**候補の信号**として使う / 姓名+主所属の一致 / 氏名の trigram 類似 |
| リード変換 | 上の両方を走らせ、候補を返して呼び手に選ばせる |

`name_normalized` の規則: 全角半角の統一、空白の除去、法人格(株式会社・(株)・有限会社・合同会社 等)の除去、英字の小文字化。

## 5. 検索

- `records.search_text` に `pg_trgm` の GIN。`search_records` はこの 1 列を引く
- 各テーブルの名前・カナにも trigram。規模が小さい(1,000 レコード)のでこれで足りる見込み。PGroonga は最良だがホスティングを縛るので採らない(01 D-01)

## 6. 未決

- Web 会議の自動連携(Q-030)。`external_ref` に会議 ID・録画・文字起こしの参照を足す見込み
- 移行元の項目対応(Q-019・Q-020)
