import type { Condition, Filter, Row, Scalar, Sort } from '@/api/types'
import { localDateOf, resolveDateMacro, todayISO } from './dates'

/**
 * フィルタの評価。モックの擬似 DB と、画面の楽観更新(更新後もこのビューに残るか)の両方で使う。
 * 本番ではサーバが同じ意味で SQL に訳す。
 */
export interface FilterContext {
  today: string
  me: string | null
}

export function defaultContext(me: string | null): FilterContext {
  return { today: todayISO(), me }
}

function resolve(value: Scalar | undefined, ctx: FilterContext): Scalar | undefined {
  if (typeof value !== 'string' || !value.startsWith('$')) return value
  if (value === '$me') return ctx.me
  return resolveDateMacro(value, ctx.today) ?? value
}

const isDateOnly = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isDateTime = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)

/** 日時の列を日付と比べるときは、利用者のタイムゾーンでの日付に直してから比べる */
function align(cell: Scalar, target: Scalar | undefined): Scalar {
  return isDateTime(cell) && isDateOnly(target) ? localDateOf(cell) : cell
}

function isEmpty(v: Scalar | undefined): boolean {
  return v === null || v === undefined || v === ''
}

/** 複数選択の値(JSON の配列の文字列)。SQL では jsonb の列 */
function asList(raw: Scalar): Scalar[] | null {
  if (typeof raw !== 'string' || !raw.startsWith('[')) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as Scalar[]) : null
  } catch {
    return null
  }
}

function matchCondition(row: Row, c: Condition, ctx: FilterContext): boolean {
  const raw = row[c.field] ?? null
  if (c.op === 'is_empty') return isEmpty(raw) || raw === '[]'
  if (c.op === 'is_not_empty') return !isEmpty(raw) && raw !== '[]'

  // 複数選択: eq / in は「どれかを含む」、ne / not_in は「どれも含まない」(SQL は jsonb の ?| / ?&)
  const list = asList(raw)
  if (list) {
    const wanted = (Array.isArray(c.value) ? c.value : [c.value ?? null]).map((v) => resolve(v, ctx))
    const hit = wanted.some((v) => list.includes(v ?? null))
    if (c.op === 'eq' || c.op === 'in' || c.op === 'contains') return hit
    if (c.op === 'ne' || c.op === 'not_in') return !hit
    return false
  }

  if (c.op === 'in' || c.op === 'not_in') {
    const list = (Array.isArray(c.value) ? c.value : [c.value ?? null]).map((v) => resolve(v, ctx))
    const hit = list.includes(raw)
    return c.op === 'in' ? hit : !hit
  }

  const target = resolve(Array.isArray(c.value) ? c.value[0] : c.value, ctx)
  const cell = align(raw, target)
  switch (c.op) {
    case 'eq':
      return cell === (target ?? null)
    case 'ne':
      return cell !== (target ?? null)
    case 'contains':
      return typeof cell === 'string' && typeof target === 'string' && cell.toLowerCase().includes(target.toLowerCase())
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      // SQL と同じく、NULL との大小比較は偽
      if (isEmpty(cell) || isEmpty(target)) return false
      const a = cell as string | number
      const b = target as string | number
      if (c.op === 'lt') return a < b
      if (c.op === 'lte') return a <= b
      if (c.op === 'gt') return a > b
      return a >= b
    }
  }
}

export function matchFilter(row: Row, filter: Filter | undefined, ctx: FilterContext): boolean {
  if (!filter) return true
  if ('and' in filter) return filter.and.every((f) => matchFilter(row, f, ctx))
  if ('or' in filter) return filter.or.some((f) => matchFilter(row, f, ctx))
  return matchCondition(row, filter, ctx)
}

/** 並び替え。NULL は昇順・降順どちらでも末尾(NULLS LAST) */
export function makeComparator(sorts: Sort[], keyOf: (row: Row, field: string) => Scalar = (r, f) => r[f] ?? null) {
  return (a: Row, b: Row): number => {
    for (const s of sorts) {
      const x = keyOf(a, s.field)
      const y = keyOf(b, s.field)
      if (x === y) continue
      if (isEmpty(x)) return 1
      if (isEmpty(y)) return -1
      const cmp =
        typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, 'ja') : (x as number) < (y as number) ? -1 : 1
      return s.dir === 'asc' ? cmp : -cmp
    }
    return 0
  }
}
