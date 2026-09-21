/**
 * ブラウザ内の擬似 DB。fixtures/*.json(DB の行と同じ形)を読み込み、
 * 絞り込み・並び替え・集計・検索を「サーバがやるはずの処理」として肩代わりする。
 * 変更は localStorage に残るので、再読み込みしても続きから触れる。
 */
import type {
  AggregateParams,
  AggregateRow,
  FieldMeta,
  ListParams,
  ObjectMeta,
  References,
  RefRecord,
  Row,
  Scalar,
  SearchHit,
  User,
  ViewMeta,
  Workspace,
} from '@/api/types'
import { addDays, addMonths, dayLabel, diffDays, localDateOf, monthLabel, startOfMonth, todayISO } from '@/lib/dates'
import { defaultContext, makeComparator, matchFilter } from '@/lib/filter'
import accountsJson from './fixtures/accounts.json'
import contactsJson from './fixtures/contacts.json'
import objectsJson from './fixtures/objects.json'
import opportunitiesJson from './fixtures/opportunities.json'
import tasksJson from './fixtures/tasks.json'
import usersJson from './fixtures/users.json'
import viewsJson from './fixtures/views.json'
import workspaceJson from './fixtures/workspace.json'

const STORAGE_KEY = 'works.mock.tables.v1'

export const objects = objectsJson as ObjectMeta[]
export const views = viewsJson as ViewMeta[]
export const users = usersJson as User[]
export const workspace = workspaceJson.workspace as Workspace

type Tables = Record<string, Row[]>

const seedTables: Tables = {
  accounts: accountsJson as Row[],
  contacts: contactsJson as Row[],
  opportunities: opportunitiesJson as Row[],
  tasks: tasksJson as Row[],
}

export function objectMeta(key: string): ObjectMeta {
  const meta = objects.find((o) => o.key === key)
  if (!meta) throw new Error(`テーブルが無い: ${key}`)
  return meta
}

// --- 読み込みと保存 ------------------------------------------------------------

/** フィクスチャの日付を「今日」基準へずらす。いつ開いても、今日のタスクや今月の商談がある状態になる */
function rebase(tables: Tables, days: number): Tables {
  if (days === 0) return structuredClone(tables)
  const out: Tables = {}
  for (const [key, rows] of Object.entries(tables)) {
    const dateFields = objectMeta(key).fields.filter((f) => f.type === 'date' || f.type === 'datetime')
    out[key] = rows.map((row) => {
      const next = { ...row }
      for (const f of dateFields) {
        const v = next[f.key]
        if (typeof v !== 'string') continue
        next[f.key] = f.type === 'date' ? addDays(v, days) : new Date(new Date(v).getTime() + days * 86400000).toISOString()
      }
      return next
    })
  }
  return out
}

function load(): Tables {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved) as Tables
  } catch {
    // 壊れていたら作り直す
  }
  return rebase(seedTables, diffDays(todayISO(), workspaceJson.base_date))
}

let tables: Tables = load()

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tables))
  } catch {
    // 保存できなくても画面は動かす
  }
}

export function resetTables() {
  localStorage.removeItem(STORAGE_KEY)
  tables = load()
}

function table(key: string): Row[] {
  objectMeta(key)
  return (tables[key] ??= [])
}

// --- 表示名の解決 --------------------------------------------------------------

function optionLabel(field: FieldMeta, value: Scalar): string | null {
  return field.options?.find((o) => o.value === value)?.label ?? null
}

/** 列の値を人が読む文字列にする(検索の補足や並び替えのキーに使う) */
function displayValue(meta: ObjectMeta, row: Row, fieldKey: string): string | null {
  const field = meta.fields.find((f) => f.key === fieldKey)
  const value = row[fieldKey] ?? null
  if (!field || value === null) return value === null ? null : String(value)
  if (field.type === 'select') return optionLabel(field, value)
  if (field.type === 'relation' && field.target) return refOf(field.target, String(value))?.name ?? null
  if (field.type === 'user') return users.find((u) => u.id === value)?.name ?? null
  return String(value)
}

function refOf(object: string, id: string): RefRecord | null {
  if (object === 'users') {
    const u = users.find((x) => x.id === id)
    return u ? { id: u.id, name: u.name, subtitle: u.email } : null
  }
  const meta = objectMeta(object)
  const row = table(object).find((r) => r.id === id)
  if (!row) return null
  return {
    id,
    name: String(row[meta.name_field] ?? ''),
    subtitle: meta.subtitle_field ? displayValue(meta, row, meta.subtitle_field) : null,
  }
}

function collectReferences(meta: ObjectMeta, rows: Row[]): References {
  const refs: References = {}
  const add = (object: string, id: Scalar) => {
    if (typeof id !== 'string') return
    const bucket = (refs[object] ??= {})
    if (bucket[id]) return
    const ref = refOf(object, id)
    if (ref) bucket[id] = ref
  }
  for (const field of meta.fields) {
    for (const row of rows) {
      if (field.type === 'relation' && field.target) add(field.target, row[field.key] ?? null)
      else if (field.type === 'user') add('users', row[field.key] ?? null)
      else if (field.type === 'polymorphic' && field.columns) {
        const object = row[field.columns.object]
        if (typeof object === 'string') add(object, row[field.columns.id] ?? null)
      }
    }
  }
  return refs
}

// --- 検索用の正規化 -------------------------------------------------------------

/** 全角半角・大文字小文字・ひらがなカタカナの違いを無視して比べるための形にする */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/\s+/g, '')
}

const TEXT_TYPES = new Set(['text', 'textarea', 'email', 'phone', 'url'])

function matchesText(meta: ObjectMeta, row: Row, needle: string): boolean {
  return meta.fields.some((f) => {
    if (!TEXT_TYPES.has(f.type)) return false
    const v = row[f.key]
    return typeof v === 'string' && normalizeText(v).includes(needle)
  })
}

// --- 公開する操作 --------------------------------------------------------------

export function query(object: string, params: ListParams, me: string | null) {
  const meta = objectMeta(object)
  const ctx = defaultContext(me)
  let rows = table(object).filter((r) => matchFilter(r, params.filter, ctx))

  const needle = params.q ? normalizeText(params.q) : ''
  if (needle) rows = rows.filter((r) => matchesText(meta, r, needle))

  if (params.sort?.length) {
    // 選択肢は定義順、参照は表示名で並べる(SQL なら CASE / JOIN に当たる)
    const keyOf = (row: Row, fieldKey: string): Scalar => {
      const field = meta.fields.find((f) => f.key === fieldKey)
      const value = row[fieldKey] ?? null
      if (!field || value === null) return value
      if (field.type === 'select') return field.options?.findIndex((o) => o.value === value) ?? -1
      if (field.type === 'relation' || field.type === 'user') return displayValue(meta, row, fieldKey)
      return value
    }
    rows = [...rows].sort(makeComparator(params.sort, keyOf))
  }

  const total = rows.length
  const offset = params.offset ?? 0
  const page = params.limit === undefined ? rows.slice(offset) : rows.slice(offset, offset + params.limit)
  return { records: structuredClone(page), total, references: collectReferences(meta, page) }
}

export function find(object: string, id: string) {
  const meta = objectMeta(object)
  const row = table(object).find((r) => r.id === id)
  if (!row) return null
  return { record: structuredClone(row), references: collectReferences(meta, [row]) }
}

/** サーバ側の業務ルール。画面に同じ計算を持たせないために、ここ(将来はバックエンド)に置く */
function applyRules(meta: ObjectMeta, before: Row | null, next: Row, patch: Record<string, Scalar>) {
  const now = new Date().toISOString()
  // 完了にしたら完了日時を入れ、戻したら消す
  const c = meta.completion
  if (c?.completed_at_field && c.field in patch) {
    const wasDone = before?.[c.field] === c.done_value
    const isDone = next[c.field] === c.done_value
    if (isDone && !wasDone) next[c.completed_at_field] = now
    if (!isDone) next[c.completed_at_field] = null
  }
  // 商談のフェーズを変えたら、確度をそのフェーズの既定値にする(確度を同時に指定したときは尊重する)
  if (meta.key === 'opportunities' && 'stage' in patch && !('probability' in patch)) {
    const stage = meta.fields.find((f) => f.key === 'stage')?.options?.find((o) => o.value === next.stage)
    if (stage?.probability !== undefined) next.probability = stage.probability
  }
  next.updated_at = now
}

export function insert(object: string, values: Record<string, Scalar>, me: string | null) {
  const meta = objectMeta(object)
  const now = new Date().toISOString()
  const row: Row = { id: crypto.randomUUID() }
  const defaults: Record<string, Scalar> = {}
  for (const field of meta.fields) {
    if (field.type === 'polymorphic' && field.columns) {
      row[field.columns.object] = null
      row[field.columns.id] = null
    } else {
      row[field.key] = null
    }
    // 必須の選択肢は先頭を既定値にする。担当は自分
    if (field.type === 'select' && field.required) defaults[field.key] = field.options?.[0]?.value ?? null
    if (field.type === 'user') defaults[field.key] = me
  }
  if (object === 'tasks') defaults.priority = 'p4'
  const effective = { ...defaults, ...values }
  Object.assign(row, effective)
  row.created_at = now
  applyRules(meta, null, row, effective)
  table(object).unshift(row)
  save()
  return find(object, row.id)!
}

export function update(object: string, id: string, patch: Record<string, Scalar>) {
  const meta = objectMeta(object)
  const rows = table(object)
  const index = rows.findIndex((r) => r.id === id)
  if (index < 0) return null
  const next = { ...rows[index], ...patch, id }
  applyRules(meta, rows[index], next, patch)
  rows[index] = next
  save()
  return find(object, id)!
}

export function remove(object: string, id: string): boolean {
  const rows = table(object)
  const index = rows.findIndex((r) => r.id === id)
  if (index < 0) return false
  rows.splice(index, 1)
  save()
  return true
}

export function restore(object: string, row: Row) {
  const rows = table(object)
  if (!rows.some((r) => r.id === row.id)) rows.unshift(structuredClone(row))
  save()
  return find(object, row.id)!
}

// --- 集計 -------------------------------------------------------------------

function measureOf(rows: Row[], m: AggregateParams['measure']): number {
  if (m.op === 'count') return rows.length
  const nums = rows
    .map((r) => {
      const v = m.field ? r[m.field] : null
      if (typeof v !== 'number') return null
      const w = m.weight_field ? r[m.weight_field] : 100
      return typeof w === 'number' ? (v * w) / 100 : v
    })
    .filter((v): v is number => v !== null)
  const sum = nums.reduce((a, b) => a + b, 0)
  return m.op === 'avg' ? (nums.length ? sum / nums.length : 0) : sum
}

export function aggregate(object: string, params: AggregateParams, me: string | null): AggregateRow[] {
  const meta = objectMeta(object)
  const ctx = defaultContext(me)
  const rows = table(object).filter((r) => matchFilter(r, params.filter, ctx))
  const g = params.group_by
  if (!g) return [{ key: null, label: '', value: measureOf(rows, params.measure) }]

  const field = meta.fields.find((f) => f.key === g.field)
  // 関連先(polymorphic)の「どのテーブルか」の列で分けるとき
  const polymorphic = meta.fields.find((f) => f.type === 'polymorphic' && f.columns?.object === g.field)

  // 日付の区間: 範囲内の区間を全部並べ、空の区間も 0 で返す
  if (g.bucket) {
    const today = todayISO()
    const bucketOf = (v: Scalar): string | null => {
      if (typeof v !== 'string') return null
      const date = v.includes('T') ? localDateOf(v) : v
      return g.bucket === 'month' ? date.slice(0, 7) : date
    }
    const keys: string[] = []
    const range = g.range ?? { from: -5, to: 0 }
    for (let i = range.from; i <= range.to; i++) {
      keys.push(g.bucket === 'month' ? addMonths(startOfMonth(today), i).slice(0, 7) : addDays(today, i))
    }
    return keys.map((key, i) => ({
      key,
      label: g.bucket === 'month' ? monthLabel(key, i === 0) : dayLabel(key),
      value: measureOf(
        rows.filter((r) => bucketOf(r[g.field] ?? null) === key),
        params.measure,
      ),
    }))
  }

  const groups = new Map<string | null, Row[]>()
  for (const row of rows) {
    const raw = row[g.field] ?? null
    const key = raw === null || raw === '' ? null : String(raw)
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  let out: AggregateRow[] = [...groups.entries()].map(([key, members]) => {
    const option = field?.options?.find((o) => o.value === key)
    let label = key ?? '未設定'
    if (key !== null) {
      if (option) label = option.label
      else if (field?.type === 'relation' && field.target) label = refOf(field.target, key)?.name ?? key
      else if (field?.type === 'user') label = users.find((u) => u.id === key)?.name ?? key
      else if (polymorphic) label = objects.find((o) => o.key === key)?.label ?? key
    } else if (polymorphic) {
      label = '関連先なし'
    }
    return { key, label, value: measureOf(members, params.measure), color: option?.color }
  })

  if (field?.options && params.order !== 'value_desc') {
    // 選択肢は定義順(フェーズの順など)。未設定は末尾
    const order = (r: AggregateRow) => (r.key === null ? 999 : field.options!.findIndex((o) => o.value === r.key))
    out.sort((a, b) => order(a) - order(b))
  } else {
    out.sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : b.value - a.value))
  }
  if (params.limit) out = out.slice(0, params.limit)
  return out
}

// --- 横断検索 -----------------------------------------------------------------

export function searchAll(q: string): SearchHit[] {
  const needle = normalizeText(q)
  if (!needle) return []
  const hits: SearchHit[] = []
  for (const meta of objects.filter((o) => o.in_sidebar).sort((a, b) => a.position - b.position)) {
    const matched = table(meta.key).filter((r) => matchesText(meta, r, needle))
    // 名前に当たったものを先に
    matched.sort((a, b) => {
      const an = normalizeText(String(a[meta.name_field] ?? '')).includes(needle) ? 0 : 1
      const bn = normalizeText(String(b[meta.name_field] ?? '')).includes(needle) ? 0 : 1
      return an - bn
    })
    for (const row of matched.slice(0, 6)) {
      const accountId = row.account_id
      const subtitle =
        typeof accountId === 'string'
          ? (refOf('accounts', accountId)?.name ?? null)
          : meta.subtitle_field
            ? displayValue(meta, row, meta.subtitle_field)
            : null
      hits.push({ object: meta.key, id: row.id, name: String(row[meta.name_field] ?? ''), subtitle })
    }
  }
  return hits
}
