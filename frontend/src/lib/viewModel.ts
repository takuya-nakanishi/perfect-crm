import { formatNumber, formatPercent, formatYen } from './format'
import type { Condition, FieldMeta, FieldType, Filter, FilterOp, MetaResponse, ObjectMeta, ViewInput, ViewMeta } from '@/api/types'

/**
 * ビューの編集画面(Notion のフィルター・並び替え・設定)の下敷き。
 * 保存する形は api/types の Filter / Sort / ViewMeta そのままで、ここは「型ごとに何を選ばせるか」を決めるだけ。
 */

// --- フィルタ ----------------------------------------------------------------

/**
 * 画面で扱うのは「条件を AND か OR で並べた 1 段」。それより深い入れ子(お気に入りの「今日」など)は
 * そのまま保ち、画面では「高度な条件」として見せる(消すことはできる)
 */
export interface FlatFilter {
  join: 'and' | 'or'
  conditions: Condition[]
  /** 1 段に直せない部分。空なら無し */
  advanced: Filter[]
}

const isCondition = (f: Filter): f is Condition => 'field' in f

export function flatten(filter: Filter | undefined): FlatFilter {
  if (!filter) return { join: 'and', conditions: [], advanced: [] }
  if (isCondition(filter)) return { join: 'and', conditions: [filter], advanced: [] }
  const join = 'and' in filter ? 'and' : 'or'
  const parts = 'and' in filter ? filter.and : filter.or
  return {
    join,
    conditions: parts.filter(isCondition),
    advanced: parts.filter((p) => !isCondition(p)),
  }
}

export function unflatten(flat: FlatFilter): Filter | undefined {
  const parts: Filter[] = [...flat.conditions, ...flat.advanced]
  if (parts.length === 0) return undefined
  if (parts.length === 1) return parts[0]
  return flat.join === 'and' ? { and: parts } : { or: parts }
}

export const OP_LABELS: Record<FilterOp, string> = {
  eq: 'が',
  ne: 'ではない',
  in: 'のどれか',
  not_in: 'のどれでもない',
  lt: 'より前',
  lte: '以前',
  gt: 'より後',
  gte: '以後',
  contains: 'を含む',
  is_empty: 'が空',
  is_not_empty: 'が空でない',
}

/** 数値では「より前 / 以後」の言い方が合わないので別の言葉にする */
const NUMBER_OP_LABELS: Partial<Record<FilterOp, string>> = { lt: 'より小さい', lte: '以下', gt: 'より大きい', gte: '以上', eq: 'と等しい', ne: 'と等しくない' }

const MULTI_OP_LABELS: Partial<Record<FilterOp, string>> = { in: 'のどれかを含む', not_in: 'のどれも含まない' }

export function opLabel(field: FieldMeta, op: FilterOp): string {
  if (['number', 'currency', 'percent'].includes(field.type)) return NUMBER_OP_LABELS[op] ?? OP_LABELS[op]
  if (field.type === 'multi_select') return MULTI_OP_LABELS[op] ?? OP_LABELS[op]
  return OP_LABELS[op]
}

/** 型ごとに選べる演算子(並びは表示順) */
export function opsFor(type: FieldType): FilterOp[] {
  switch (type) {
    case 'select':
      return ['eq', 'ne', 'in', 'not_in', 'is_empty', 'is_not_empty']
    case 'multi_select':
      return ['in', 'not_in', 'is_empty', 'is_not_empty']
    case 'number':
    case 'currency':
    case 'percent':
      return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty']
    case 'date':
    case 'datetime':
      return ['eq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty']
    case 'checkbox':
      return ['eq']
    case 'relation':
    case 'user':
      return ['eq', 'ne', 'is_empty', 'is_not_empty']
    case 'polymorphic':
    case 'drive_files':
      return ['is_empty', 'is_not_empty']
    default:
      return ['contains', 'eq', 'ne', 'is_empty', 'is_not_empty']
  }
}

export const needsValue = (op: FilterOp) => op !== 'is_empty' && op !== 'is_not_empty'
export const multiValue = (op: FilterOp) => op === 'in' || op === 'not_in'

/** 日付の条件で選べる「今日を基準にした値」。サーバが解決するマクロ(04 §3) */
export const DATE_MACROS: { value: string; label: string }[] = [
  { value: '$today', label: '今日' },
  { value: '$today+1', label: '明日' },
  { value: '$today-1', label: '昨日' },
  { value: '$today+7', label: '7 日後' },
  { value: '$today-7', label: '7 日前' },
  { value: '$today+30', label: '30 日後' },
  { value: '$today-30', label: '30 日前' },
  { value: '$start_of_month', label: '今月の初め' },
  { value: '$end_of_month', label: '今月の末' },
]

export function dateValueLabel(value: string): string {
  return DATE_MACROS.find((m) => m.value === value)?.label ?? value.replaceAll('-', '/')
}

/** 条件に使える項目(システムの列も含む。関連先は「テーブル名の列」で指す) */
export function filterableFields(object: ObjectMeta): FieldMeta[] {
  return object.fields.filter((f) => f.type !== 'polymorphic')
}

/** その型の最初の条件。値は空にしておき、画面で選ばせる */
export function newCondition(field: FieldMeta): Condition {
  const op = opsFor(field.type)[0]
  if (field.type === 'checkbox') return { field: field.key, op, value: true }
  if (field.type === 'date' || field.type === 'datetime') return { field: field.key, op, value: '$today' }
  return needsValue(op) ? { field: field.key, op, value: multiValue(op) ? [] : null } : { field: field.key, op }
}

/** 値が入っていない条件は、まだ効かせない(サーバへも送らない) */
export function isComplete(c: Condition): boolean {
  if (!needsValue(c.op)) return true
  if (Array.isArray(c.value)) return c.value.length > 0
  return c.value !== null && c.value !== undefined && c.value !== ''
}

// --- ビュー ------------------------------------------------------------------

/** 一覧の列に出せる項目(複数行の文字は出さない) */
export function columnCandidates(object: ObjectMeta): FieldMeta[] {
  return object.fields.filter((f) => f.type !== 'textarea' && f.type !== 'richtext')
}

const COLUMN_WIDTH: Partial<Record<FieldType, number>> = { relation: 200, email: 220, url: 200, phone: 150, checkbox: 90, datetime: 140, date: 120, select: 120, user: 130 }

export function defaultWidth(object: ObjectMeta, field: FieldMeta): number {
  return field.key === object.name_field ? 280 : (COLUMN_WIDTH[field.type] ?? 140)
}

/** 新しいビューの初期値。一覧は表示名 + 先頭の数項目、カンバンは最初の選択肢の項目で分ける */
export function newViewInput(object: ObjectMeta, type: 'list' | 'kanban', name: string, base?: ViewMeta): ViewInput | null {
  const inherit = base && base.type !== 'report' ? { filter: base.config.filter, sort: base.config.sort } : {}
  if (type === 'list') {
    const columns =
      base?.type === 'list'
        ? base.config.columns
        : columnCandidates(object)
            .filter((f) => !f.readonly)
            .slice(0, 6)
            .map((f) => ({ field: f.key, width: defaultWidth(object, f) }))
    return { name, type: 'list', config: { columns, ...inherit } }
  }
  const groupBy = base?.type === 'kanban' ? object.fields.find((f) => f.key === base.config.group_by) : object.fields.find((f) => f.type === 'select')
  if (!groupBy) return null
  const cards = object.fields.filter((f) => !f.readonly && f.key !== object.name_field && f.key !== groupBy.key && f.type !== 'textarea' && f.type !== 'richtext')
  return {
    name,
    type: 'kanban',
    config: {
      group_by: groupBy.key,
      card_fields: base?.type === 'kanban' ? base.config.card_fields.filter((k) => k !== groupBy.key) : cards.slice(0, 3).map((f) => f.key),
      sum_field: cards.find((f) => f.type === 'currency')?.key,
      ...inherit,
    },
  }
}

export function toInput(view: ViewMeta): ViewInput {
  const { id: _id, object: _object, position: _position, ...rest } = view
  return structuredClone(rest)
}

/** タブの名前の既定。同じ名前があれば番号を足す */
export function uniqueName(base: string, views: ViewMeta[]): string {
  const taken = new Set(views.map((v) => v.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

/** チップに出す短い言い方: 「業種 が 医療・福祉」「期限 以前 今日」 */
export function describe(meta: MetaResponse, field: FieldMeta, c: Condition): { op: string; value: string } {
  const values = Array.isArray(c.value) ? c.value : c.value === null || c.value === undefined ? [] : [c.value]
  let value = ''
  if (needsValue(c.op)) {
    if (field.type === 'select' || field.type === 'multi_select') value = values.map((v) => field.options?.find((o) => o.value === v)?.label ?? String(v)).join(', ')
    else if (field.type === 'user') value = values.map((v) => (v === '$me' ? '自分' : (meta.users.find((u) => u.id === v)?.name ?? '…'))).join(', ')
    else if (field.type === 'relation') value = c.value_label ?? '…'
    else if (field.type === 'checkbox') value = values[0] ? 'はい' : 'いいえ'
    else if (field.type === 'date' || field.type === 'datetime') value = typeof values[0] === 'string' ? (DATE_MACROS.find((m) => m.value === values[0])?.label ?? String(values[0]).replaceAll('-', '/')) : ''
    else if (field.type === 'currency') value = values.map((v) => (typeof v === 'number' ? formatYen(v) : String(v))).join(', ')
    else if (field.type === 'number' || field.type === 'percent') value = values.map((v) => (typeof v === 'number' ? (field.type === 'percent' ? formatPercent(v, field.scale) : formatNumber(v, field.scale)) : String(v))).join(', ')
    else value = values.map(String).join(', ')
    if (!value) value = '…'
  }
  return { op: opLabel(field, c.op), value }
}
