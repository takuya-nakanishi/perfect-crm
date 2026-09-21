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
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'select'
  | 'checkbox'
  | 'email'
  | 'phone'
  | 'url'
  | 'relation' // 別テーブルへの FK(列 = key)
  | 'polymorphic' // 複数テーブルのどれかを指す(列 = columns.object + columns.id)
  | 'user' // users への FK

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
  position: number
  /** サイドバーに出すか */
  in_sidebar: boolean
  fields: FieldMeta[]
  /** チェックで完了にできるテーブル(タスク)。field を done_value にすると完了 */
  completion?: { field: string; done_value: string; open_value: string; completed_at_field?: string }
}

export type ViewType = 'list' | 'kanban' | 'report'

export interface ListViewConfig {
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

export interface User {
  id: string
  name: string
  email: string
  avatar_color: TagColor
}

export interface Workspace {
  id: string
  name: string
}

/** GET /api/v1/meta — 起動時に 1 回読む */
export interface MetaResponse {
  workspace: Workspace
  objects: ObjectMeta[]
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
