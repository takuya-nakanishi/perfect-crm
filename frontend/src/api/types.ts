/**
 * 画面とバックエンドの契約。ここに書いた形が、将来 Python バックエンドの JSON レスポンスになる。
 * モック(src/mocks)も同じ型を返すので、差し替えは client.ts の 1 行で済む。
 *
 * 規約:
 * - 列名は PostgreSQL の列名そのまま(snake_case)。画面側で camelCase に変換しない
 * - ID は UUID 文字列。日付は 'YYYY-MM-DD'、日時は ISO 8601(UTC)
 * - メタデータ(テーブル・項目・ビューの定義)もデータ。画面はこれを読んで描画する
 */

// ---------------------------------------------------------------------------
// メタデータ
// ---------------------------------------------------------------------------

export type FieldType =
  | 'text'
  | 'textarea'
  | 'richtext' // 書式付きの文字。値は HTML(許す要素は lib/richtext.ts の allowlist)
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multi_select' // 複数選択。値は選択肢の value の配列を JSON 文字列で(ラベルなど)
  | 'checkbox'
  | 'email'
  | 'phone'
  | 'url'
  | 'relation' // 別テーブルへの FK(列 = key)
  | 'polymorphic' // 複数テーブルのどれかを指す(列 = columns.object + columns.id)
  | 'user' // users への FK
  | 'drive_files' // Google ドライブのファイル(複数)。値は DriveFile[] の JSON 文字列

/** 選択肢の色。値は styles/index.css の --tag-* に対応する */
export type TagColor = 'gray' | 'green' | 'teal' | 'blue' | 'violet' | 'pink' | 'red' | 'orange' | 'amber'

export interface SelectOption {
  value: string
  label: string
  color: TagColor
  /** 商談フェーズなど、選択肢に付随する属性(確度の既定値、進行中/受注/失注の区別) */
  probability?: number
  kind?: 'open' | 'won' | 'lost' | 'done'
}

export interface FieldMeta {
  /** 列名。polymorphic のときは論理名で、実際の列は columns に書く */
  key: string
  label: string
  type: FieldType
  required?: boolean
  /** システムが埋める列(created_at など)。画面から編集させない */
  readonly?: boolean
  options?: SelectOption[]
  /** relation: 参照先テーブル */
  target?: string
  /** polymorphic: 参照先になりうるテーブル */
  targets?: string[]
  /** polymorphic: テーブル名を持つ列と ID を持つ列 */
  columns?: { object: string; id: string }
  /** date: 締め切りを表す列。過ぎていて、レコードがまだ終わっていなければ注意色で出す */
  semantic?: 'deadline'
  /** 新規作成フォームに出すか(既定 true。readonly は常に出さない) */
  in_create_form?: boolean
  placeholder?: string
  /** 文字の列: 最大の文字数(桁数)。超える値はサーバが 400 で断る */
  max_length?: number
  /** number / percent: 小数点以下の桁数(既定 0)。サーバがこの桁で丸める */
  scale?: number
  /** 業務ルールが使う列(完了の状況、商談のフェーズなど)。テーブル設定から削除・型の変更ができない */
  locked?: boolean
  /** polymorphic: 全テーブルを指せる(活動の関連先)。テーブルを足すと targets にも加わる */
  all_targets?: boolean
}

export interface ObjectMeta {
  /** テーブル名。URL と API のキーにも使う */
  key: string
  label: string
  /** lucide のアイコン名(lib/icons.tsx の対応表にあるもの) */
  icon: string
  color: TagColor
  /** レコードの表示名に使う列 */
  name_field: string
  /** 一覧やリンクで名前の下に添える列(任意) */
  subtitle_field?: string
  /**
   * サイドバーの並び。フォルダ(`FolderMeta.position`)と同じ通し番号で、フォルダ → その中のテーブル → 次の…の順に振る。
   * だから position だけで並べても、フォルダを全部開いたときの見える順になる(02 §2)
   */
  position: number
  /** サイドバーに出すか */
  in_sidebar: boolean
  /** 入っているサイドバーのフォルダ。無ければフォルダの外(直下) */
  folder_id?: string
  fields: FieldMeta[]
  /**
   * チェックで完了にできるテーブル(タスク)。field を done_value にすると完了。
   * 繰り返し(Todoist の型): repeat_field(規則の選択肢)があり、完了したときに値が入っていれば、その回は完了済みとして残り、
   * 次回のタスクをサーバが作る(repeat_of_field に前回の ID)。完了を戻すと、自動で作った次回を消す。02 §3
   */
  completion?: {
    field: string
    done_value: string
    open_value: string
    completed_at_field?: string
    repeat_field?: string
    /** チェックの列。真なら次回は完了した日から数える(Todoist の every!)。偽なら元の期限から(every) */
    repeat_from_completion_field?: string
    repeat_of_field?: string
    /** 次回の期限を入れる日付の列(無ければ semantic: deadline の列) */
    due_field?: string
  }
  /** 初めから入っているテーブル。業務ルールや画面の機能(タスクの追加)が前提にしているので削除できない */
  system?: boolean
  /**
   * 活動(時系列の記録)のテーブル。レコードのパネルに、関連リストではなく時系列(タイムライン)として出す。
   * subject / type / date / body は、それぞれ件名・種別・日付・内容の列名
   */
  timeline?: { subject: string; type: string; date: string; body: string }
}

// ---------------------------------------------------------------------------
// テーブル設定(画面からテーブルと項目を足す・直す)
// ---------------------------------------------------------------------------

/** 画面から決められる項目の属性。システムが埋める列(作成日時・更新日時)は含めない */
export type FieldInput = Pick<
  FieldMeta,
  'key' | 'label' | 'type' | 'required' | 'options' | 'target' | 'max_length' | 'scale' | 'placeholder'
>

/**
 * POST /api/v1/meta/objects(作成)と PUT /api/v1/meta/objects/{key}(更新)の本文。
 * - fields は並び順どおりの全量。更新時、ここに無い項目は外れる(列の値は残るので、同じ列名で戻せば復活する)
 * - 作成時は先頭の項目がレコードの表示名(name_field)になる。文字型・必須に固定
 * - 既にある項目の列名と型は変えられない。ここに書けない属性(semantic など)は元のまま保たれる
 */
export interface ObjectInput {
  /** テーブル名(列名と同じ規則: 小文字の英字で始まり、英数字と _)。作成後は変えられない */
  key: string
  label: string
  icon: string
  color: TagColor
  /** サイドバーに出すか(既定 true)。出さなくても、レコードのパネルや検索からは開ける */
  in_sidebar?: boolean
  fields: FieldInput[]
}

// ---------------------------------------------------------------------------
// サイドバーのフォルダと並び
// ---------------------------------------------------------------------------

/** サイドバーのフォルダ。テーブルをまとめて、畳んだり開いたりする。1 段だけ(フォルダの中にフォルダは入れない) */
export interface FolderMeta {
  id: string
  label: string
  /** テーブルの position と同じ通し番号(フォルダの直後に、その中のテーブルが続く) */
  position: number
}

/**
 * PUT /api/v1/meta/sidebar の本文の 1 行。サイドバーの並びとフォルダを、上から順に**全量**で送る(05 §13)。
 * - フォルダの中はテーブルだけ。サイドバーに出していないテーブルも、居場所を保つために含めてよい
 * - 本文に無いフォルダは消える(中のテーブルはフォルダの外へ)。新しいフォルダの id は画面が振る(UUID)。
 *   だから「元に戻す」は、前の並びをもう一度送るだけで済む
 * - 本文に無いテーブル(別の画面で足した直後のものなど)は、末尾にフォルダの外で続く
 */
export type SidebarItem = { type: 'object'; key: string } | { type: 'folder'; id: string; label: string; keys: string[] }

// ---------------------------------------------------------------------------
// 環境設定: MCP のアクセストークン、Web フォーム
// ---------------------------------------------------------------------------

/** MCP(や将来の API)に繋ぐためのトークン。値は発行したときに 1 回だけ返す */
export interface McpToken {
  id: string
  name: string
  /** 繋いだアプリ(User-Agent から推定。発行時は利用者が選んだもの) */
  client: 'claude-desktop' | 'claude-code' | 'codex' | 'other'
  /** 見分けるための先頭 8 文字 */
  prefix: string
  created_by: string
  created_at: string
  last_used_at: string | null
}

export interface McpTokenCreated {
  token: McpToken
  /** 全文。この応答でしか見られない */
  secret: string
}

/**
 * OAuth で許可したアプリ(Claude のカスタムコネクタなど。04 §13)。Claude に 1 回足すと、
 * Web・デスクトップ・スマホ・Claude Code のどれから使ってもこの 1 行になる
 */
export interface McpConnection {
  id: string
  /** アプリが登録時に名乗った名前(Claude なら "Claude") */
  client_name: string
  user_id: string
  user_name: string
  created_at: string
  last_used_at: string | null
}

/** 許可の画面(/oauth/consent)に出す、Claude からの接続の依頼 */
export interface OAuthRequest {
  id: string
  client_name: string
  /** 許可したあとに戻る先のホスト(claude.ai、Claude Code なら localhost) */
  redirect_host: string
  scopes: string[]
}

/**
 * Web フォーム(Salesforce の Web-to-Lead の汎用版)。どのテーブルにも作れる。
 * 受け口は POST /api/v1/forms/{key}(認証なし。本文は form-urlencoded か JSON)。列名 → 値で受け、fields に無い列は捨てる
 */
export interface WebForm {
  id: string
  name: string
  object: string
  /** 受け付ける列(この順に埋め込み用の HTML を出す) */
  fields: string[]
  /** 受け付けた値に足す既定値(種別 = 見込み客、担当 = 自分 など) */
  defaults: Record<string, Scalar>
  /** 受け口の URL に入る鍵。作り直せる */
  key: string
  enabled: boolean
  /** 送信後に戻す URL(空なら「受け付けました」の小さな画面) */
  redirect_url: string | null
  created_at: string
  submissions: number
  last_submitted_at: string | null
}

export type WebFormInput = Pick<WebForm, 'name' | 'object' | 'fields' | 'defaults' | 'enabled' | 'redirect_url'>

export type ViewType = 'list' | 'kanban' | 'report'

export interface ListViewConfig {
  /** 表示する列(この順)。width は px(無ければ 160。画面は 60〜1200 に収めて描く。05 §12) */
  columns: { field: string; width?: number }[]
  filter?: Filter
  sort?: Sort[]
}

export interface KanbanViewConfig {
  group_by: string
  card_fields: string[]
  /** 列見出しに合計を出す数値列(任意) */
  sum_field?: string
  filter?: Filter
  sort?: Sort[]
  /** 列として出さない選択肢(完了済みなど) */
  hidden_groups?: string[]
}

export type WidgetFormat = 'number' | 'currency' | 'percent'

export interface StatWidget {
  id: string
  type: 'stat'
  title: string
  measure: Measure
  filter?: Filter
  /** 指定すると「filter の集計 ÷ この条件の集計」を割合で出す(受注率など) */
  denominator_filter?: Filter
  format: WidgetFormat
  /** 値の下に添える補足(件数など) */
  secondary?: { measure: Measure; format: WidgetFormat; suffix: string }
  /** 0 でないとき注意色にする(期限切れ件数など) */
  tone?: 'default' | 'alert'
}

export interface ChartWidget {
  id: string
  type: 'bar' | 'column'
  title: string
  description?: string
  group_by: GroupBy
  measure: Measure
  filter?: Filter
  format: WidgetFormat
  /** ordinal = 順序のある区分(フェーズ等)を 1 色の濃淡で / single = 全部同じ色 */
  color: 'single' | 'ordinal'
  order?: AggregateParams['order']
  limit?: number
  /** レポート上で横幅いっぱいに置くか */
  wide?: boolean
}

export type ReportWidget = StatWidget | ChartWidget

export interface ReportViewConfig {
  widgets: ReportWidget[]
}

interface ViewBase {
  id: string
  object: string
  name: string
  position: number
  /** サイドバーの「お気に入り」に出す */
  pin?: { label: string; position: number; show_count?: boolean }
}

export type ViewMeta =
  | (ViewBase & { type: 'list'; config: ListViewConfig })
  | (ViewBase & { type: 'kanban'; config: KanbanViewConfig })
  | (ViewBase & { type: 'report'; config: ReportViewConfig })

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

/**
 * POST /api/v1/meta/views(作成。object を添える)と PUT /api/v1/meta/views/{id}(更新)の本文。
 * 画面から編集するのは name・type・config・pin。position は並べ替えの API で振る
 */
export type ViewInput = DistributiveOmit<ViewMeta, 'id' | 'object' | 'position'>

export interface User {
  id: string
  name: string
  email: string
  avatar_color: TagColor
  /** 環境設定(テーブル・Web フォーム・MCP)を触れる利用者。ロールは持たない(権限の設計は J-038) */
  admin?: boolean
}

export interface Workspace {
  id: string
  name: string
  /** 「今日」の基準(IANA)。フィルタのマクロと日時→日付の変換はこの時刻帯で(04 §3)。利用者ごとには持たない */
  timezone: string
}

/** GET /api/v1/meta — 起動時に 1 回読む */
export interface MetaResponse {
  workspace: Workspace
  objects: ObjectMeta[]
  /** サイドバーのフォルダ(テーブルをまとめて畳む) */
  folders: FolderMeta[]
  views: ViewMeta[]
  users: User[]
}

// ---------------------------------------------------------------------------
// レコードとクエリ
// ---------------------------------------------------------------------------

export type Scalar = string | number | boolean | null

/** DB の 1 行。列名 → 値 */
export type Row = { id: string } & Record<string, Scalar>

export type FilterOp =
  | 'eq'
  | 'ne'
  | 'in'
  | 'not_in'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'contains'
  | 'is_empty'
  | 'is_not_empty'

/**
 * 値に書けるマクロ(サーバ側で解決する):
 * $today / $today+7 / $today-30 / $start_of_month / $end_of_month / $me
 */
export interface Condition {
  field: string
  op: FilterOp
  value?: Scalar | Scalar[]
  /** 参照の条件で、画面が表示名を添えておく(チップに出すため)。サーバは評価に使わない */
  value_label?: string
}

export type Filter = Condition | { and: Filter[] } | { or: Filter[] }

export interface Sort {
  field: string
  dir: 'asc' | 'desc'
}

/** GET /api/v1/objects/{object}/records */
export interface ListParams {
  filter?: Filter
  sort?: Sort[]
  /** 名前列などへの部分一致(一覧上部の絞り込み) */
  q?: string
  limit?: number
  offset?: number
}

/** 参照先レコードの表示用の最小情報。サーバが JOIN して返す */
export interface RefRecord {
  id: string
  name: string
  subtitle?: string | null
}

/** テーブル名 → ID → 表示情報 */
export type References = Record<string, Record<string, RefRecord>>

export interface ListResponse {
  records: Row[]
  total: number
  references: References
}

export interface RecordResponse {
  record: Row
  references: References
}

// ---------------------------------------------------------------------------
// 集計(レポート)
// ---------------------------------------------------------------------------

export interface Measure {
  op: 'count' | 'sum' | 'avg'
  field?: string
  /** sum のとき、この列(0〜100 の百分率)を掛けてから足す。確度を掛けた見込み金額に使う */
  weight_field?: string
}

export interface GroupBy {
  field: string
  /** 日付列をまとめる単位 */
  bucket?: 'day' | 'month'
  /** bucket 指定時: 今日を基準にした範囲(単位は bucket と同じ)。空の区間も 0 で返す */
  range?: { from: number; to: number }
}

/** POST /api/v1/objects/{object}/aggregate */
export interface AggregateParams {
  filter?: Filter
  group_by?: GroupBy
  measure: Measure
  /**
   * 並び。省略時は group(選択肢は定義順、日付は時間順、それ以外は値の大きい順)。
   * value_desc は選択肢でも値の大きい順にする(業種のように順序の無い区分向け)
   */
  order?: 'group' | 'value_desc'
  limit?: number
}

export interface AggregateRow {
  /** グループの値(選択肢の value、参照先の ID、'2026-09' など)。group_by 無しは null */
  key: string | null
  /** 表示名。サーバが解決して返す */
  label: string
  value: number
  color?: TagColor
}

export interface AggregateResponse {
  rows: AggregateRow[]
}

// ---------------------------------------------------------------------------
// 時系列(レコードのパネルの「活動」)
// ---------------------------------------------------------------------------

/**
 * GET /objects/{object}/records/{id}/timeline の 1 行。サーバが 3 つを合成する:
 * - activity: そのレコードを関連先にした活動
 * - mention: 内容の中で @ で言及された活動(関連先は別のレコード)
 * - completion: そのレコードに付いた、完了したタスク(活動テーブルには複製しない。初めから完了していたデータも出る)
 */
export interface TimelineEntry {
  kind: 'activity' | 'mention' | 'completion'
  /** 元のレコード(activities / tasks)。押すと開く */
  object: string
  id: string
  /** 記録の日付(活動は occurred_on、完了したタスクは completed_at の日付) */
  date: string
  /** 同じ日の中の並び(新しい順)に使う日時 */
  at: string
  subject: string
  /** 活動の種別(completion には無い) */
  type?: SelectOption | null
  /** 内容(HTML)。タスクは詳細を段落にしたもの */
  body?: string | null
  user_id?: string | null
  /** その記録の関連先。開いているレコードと違うとき(言及)に出す */
  related?: { object: string; id: string; name: string } | null
}

export interface TimelineResponse {
  entries: TimelineEntry[]
}

// ---------------------------------------------------------------------------
// Google ドライブ(drive_files 型の項目)
// ---------------------------------------------------------------------------

/** GET /api/v1/google/status — いまログインしている利用者の Google の繋がり具合 */
export interface GoogleStatus {
  /** この利用者が Google を繋いでいるか */
  connected: boolean
  /** 繋いでいる Google のアドレス(繋いでいなければ null) */
  email: string | null
  /** 管理者が OAuth クライアント(.env)を入れているか。false なら繋ぐこともできない */
  configured: boolean
}

/** ドライブのファイル 1 つ。項目の値は、これを並べた JSON 文字列 */
export interface DriveFile {
  id: string
  name: string
  /** Google の MIME(application/vnd.google-apps.document など) */
  mime_type: string
  /** 開くための URL */
  url: string
}

// ---------------------------------------------------------------------------
// 取り込みと書き出し(CSV)
// ---------------------------------------------------------------------------

/** POST /api/v1/objects/{object}/import */
export interface ImportParams {
  /** CSV の本文(1 行目は見出し) */
  csv: string
  /** 見出し → 列名。null は取り込まない列。省略した見出しは、サーバが項目名と列名から推測する */
  mapping?: Record<string, string | null>
  /** true なら検証だけして書き込まない(取り込む前の確認に使う) */
  dry_run?: boolean
}

export interface ImportResponse {
  headers: string[]
  /** 実際に使った対応(推測した結果を含む) */
  mapping: Record<string, string | null>
  /** データ行の数と、そのうち取り込める行の数。取り込めない行は飛ばす */
  total: number
  valid: number
  /** 取り込めない行と理由(先頭 20 件)。line は CSV の行番号(見出しが 1) */
  errors: { line: number; message: string }[]
  /** 先頭 5 行(見出しと同じ並びの、生の文字) */
  sample: string[][]
  /** 作成したレコード(dry_run では空)。取り消しに使う */
  created_ids: string[]
}

// ---------------------------------------------------------------------------
// 検索・セッション
// ---------------------------------------------------------------------------

export interface SearchHit {
  object: string
  id: string
  name: string
  subtitle: string | null
}

export interface SearchResponse {
  hits: SearchHit[]
}

export interface Session {
  user: User
  workspace: Workspace
}

/** エラーは HTTP ステータス + この形 */
export interface ApiErrorBody {
  code: string
  message: string
}
