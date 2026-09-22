/**
 * ブラウザ内の擬似 DB。fixtures/*.json(DB の行と同じ形)を読み込み、
 * 絞り込み・並び替え・集計・検索を「サーバがやるはずの処理」として肩代わりする。
 * 変更は localStorage に残るので、再読み込みしても続きから触れる。
 * テーブルと項目の定義は schema.ts が持つ。
 */
import { ApiError } from '@/api/client'
import type {
  AggregateParams,
  AggregateRow,
  FieldMeta,
  ListParams,
  MetaResponse,
  ObjectInput,
  ObjectMeta,
  References,
  RefRecord,
  Row,
  Scalar,
  SearchHit,
  TimelineEntry,
  ViewInput,
} from '@/api/types'
import { addDays, addMonths, dayLabel, diffDays, localDateOf, monthLabel, startOfMonth, todayISO } from '@/lib/dates'
import { defaultContext, makeComparator, matchFilter } from '@/lib/filter'
import { nextDue } from '@/lib/recurrence'
import { extractMentions, plainText, sanitizeHtml } from '@/lib/richtext'
import accountsJson from './fixtures/accounts.json'
import activitiesJson from './fixtures/activities.json'
import contactsJson from './fixtures/contacts.json'
import opportunitiesJson from './fixtures/opportunities.json'
import tasksJson from './fixtures/tasks.json'
import workspaceJson from './fixtures/workspace.json'
import * as schema from './schema'
import { liveObjects, objectMeta, users, workspace } from './schema'

export { objectMeta, users, workspace }

const STORAGE_KEY = 'works.mock.tables.v1'

type Tables = Record<string, Row[]>

const seedTables: Tables = {
  accounts: accountsJson as Row[],
  contacts: contactsJson as Row[],
  opportunities: opportunitiesJson as Row[],
  tasks: tasksJson as Row[],
  activities: activitiesJson as Row[],
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
  const fresh = () => rebase(seedTables, diffDays(todayISO(), workspaceJson.base_date))
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const loaded = JSON.parse(saved) as Tables
      // あとから増えた種のテーブル(活動など)は、保存済みのデータに無いので初期データで埋める
      const missing = Object.keys(seedTables).filter((k) => !(k in loaded))
      if (missing.length > 0) {
        const seeded = fresh()
        for (const k of missing) loaded[k] = seeded[k]
      }
      return loaded
    }
  } catch {
    // 壊れていたら作り直す
  }
  return fresh()
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
  schema.resetSchema()
  tables = load()
}

export function table(key: string): Row[] {
  objectMeta(key)
  return (tables[key] ??= [])
}

// --- 表示名の解決 --------------------------------------------------------------

/** 複数選択の値(JSON の配列の文字列)を読む。壊れていれば空 */
export function parseList(value: Scalar | undefined): Scalar[] {
  if (typeof value !== 'string' || !value.startsWith('[')) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as Scalar[]) : []
  } catch {
    return []
  }
}

function optionLabel(field: FieldMeta, value: Scalar): string | null {
  return field.options?.find((o) => o.value === value)?.label ?? null
}

/** 列の値を人が読む文字列にする(検索の補足や並び替えのキーに使う) */
export function displayValue(meta: ObjectMeta, row: Row, fieldKey: string): string | null {
  const field = meta.fields.find((f) => f.key === fieldKey)
  const value = row[fieldKey] ?? null
  if (!field || value === null) return value === null ? null : String(value)
  if (field.type === 'select') return optionLabel(field, value)
  if (field.type === 'multi_select') return parseList(value).map((v) => optionLabel(field, v) ?? String(v)).join('、') || null
  if (field.type === 'relation' && field.target) return refOf(field.target, String(value))?.name ?? null
  if (field.type === 'user') return users.find((u) => u.id === value)?.name ?? null
  return String(value)
}

export function refOf(object: string, id: string): RefRecord | null {
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

const TEXT_TYPES = new Set(['text', 'textarea', 'richtext', 'email', 'phone', 'url'])

function matchesText(meta: ObjectMeta, row: Row, needle: string): boolean {
  return meta.fields.some((f) => {
    if (!TEXT_TYPES.has(f.type)) return false
    const v = row[f.key]
    if (typeof v !== 'string') return false
    // 書式付きの文字は、タグを落としてから比べる(<strong> の中の語も当たる)
    return normalizeText(f.type === 'richtext' ? plainText(v) : v).includes(needle)
  })
}

// --- 公開する操作 --------------------------------------------------------------

export function query(object: string, params: ListParams, me: string | null) {
  const meta = objectMeta(object)
  const ctx = defaultContext(me, workspace.timezone)
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
function applyRules(meta: ObjectMeta, before: Row | null, next: Row, patch: Record<string, Scalar>, me: string | null) {
  const now = new Date().toISOString()
  // 完了にしたら完了日時を入れ、戻したら消す。あわせて活動に記録する
  const c = meta.completion
  if (c?.completed_at_field && c.field in patch) {
    const wasDone = before?.[c.field] === c.done_value
    const isDone = next[c.field] === c.done_value
    // 完了日時を一緒に渡されたら尊重する(移行で元の日時を保つため。04 §11)。無ければ今
    if (isDone && !wasDone && !(c.completed_at_field in patch && next[c.completed_at_field])) next[c.completed_at_field] = now
    if (!isDone) next[c.completed_at_field] = null
  }
  if (meta.timeline) {
    // 活動の日付が空なら今日。内容の @ の言及は mentions 列(テーブル名:ID の JSON)に写す。時系列 API が引く
    if (!next[meta.timeline.date]) next[meta.timeline.date] = localDateOf(now)
    if (meta.timeline.body in patch || before === null) {
      // 保存前に洗浄し(許した要素だけに)、その結果から言及を取る。順序は 04 §1 の決まり
      const raw = next[meta.timeline.body]
      const body = typeof raw === 'string' && raw ? sanitizeHtml(raw) : null
      next[meta.timeline.body] = body
      const ids = extractMentions(body).map((m) => `${m.object}:${m.id}`)
      next.mentions = ids.length ? JSON.stringify(ids) : null
    }
  }
  void me
  // 商談のフェーズを変えたら、確度をそのフェーズの既定値にする(確度を同時に指定したときは尊重する)
  if (meta.key === 'opportunities' && 'stage' in patch && !('probability' in patch)) {
    const stage = meta.fields.find((f) => f.key === 'stage')?.options?.find((o) => o.value === next.stage)
    if (stage?.probability !== undefined) next.probability = stage.probability
  }
  next.updated_at = now
}

/**
 * 項目の定義(必須・桁数・選択肢・小数の桁数)に照らして値を確かめ、丸める。画面も同じことを先に見るが、
 * MCP や取り込みからも同じ経路で書くので、最後の砦はここ
 */
function validate(meta: ObjectMeta, row: Row, keys: string[] | null) {
  for (const field of meta.fields) {
    if (field.readonly || field.type === 'polymorphic') continue
    if (keys && !keys.includes(field.key)) continue
    const value = row[field.key] ?? null
    if (value === null || value === '') {
      if (field.required && field.type !== 'checkbox') throw new ApiError(400, 'invalid', `${field.label}を入力してください`)
      continue
    }
    if (field.max_length && typeof value === 'string' && [...(field.type === 'richtext' ? plainText(value) : value)].length > field.max_length) {
      throw new ApiError(400, 'invalid', `${field.label}は ${field.max_length} 文字までです`)
    }
    if (field.type === 'select' && !field.options?.some((o) => o.value === value)) {
      throw new ApiError(400, 'invalid', `${field.label}に無い選択肢です: ${String(value)}`)
    }
    if (field.type === 'multi_select') {
      const list = parseList(value)
      if (typeof value !== 'string' || !value.startsWith('[')) throw new ApiError(400, 'invalid', `${field.label}は選択肢の配列で指定してください`)
      const bad = list.find((v) => !field.options?.some((o) => o.value === v))
      if (bad !== undefined) throw new ApiError(400, 'invalid', `${field.label}に無い選択肢です: ${String(bad)}`)
      // 重複を除き、定義順に揃えて保存する
      row[field.key] = list.length ? JSON.stringify((field.options ?? []).map((o) => o.value).filter((v) => list.includes(v))) : null
    }
    // 型: 数値は数値、日付は YYYY-MM-DD、日時は ISO 8601、チェックは真偽。文字を受けるのは取り込みと Web フォームの変換(csv.ts の coerce)の仕事
    if (['number', 'currency', 'percent'].includes(field.type) && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new ApiError(400, 'invalid', `${field.label}は数値で指定してください`)
    }
    if (field.type === 'date' && !(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)))) {
      throw new ApiError(400, 'invalid', `${field.label}は YYYY-MM-DD で指定してください`)
    }
    if (field.type === 'datetime' && !(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value)))) {
      throw new ApiError(400, 'invalid', `${field.label}は ISO 8601 の日時で指定してください`)
    }
    if (field.type === 'checkbox' && typeof value !== 'boolean') throw new ApiError(400, 'invalid', `${field.label}は真偽で指定してください`)
    // 参照整合: 参照先のレコードがあること(論理削除は無いので、行があれば有効)
    if (field.type === 'relation' && field.target && !(typeof value === 'string' && table(field.target).some((r) => r.id === value))) {
      throw new ApiError(400, 'invalid', `${field.label}の参照先が見つかりません`)
    }
    if (field.type === 'user' && !users.some((u) => u.id === value)) throw new ApiError(400, 'invalid', `${field.label}の利用者がいません`)
    if (field.scale !== undefined && typeof value === 'number') {
      const unit = 10 ** field.scale
      row[field.key] = Math.round(value * unit) / unit
    }
  }
  // 関連先(polymorphic): テーブル名は targets の中、ID はそのテーブルにあること。片方だけは不可
  for (const field of meta.fields) {
    if (field.type !== 'polymorphic' || !field.columns) continue
    if (keys && !keys.includes(field.columns.object) && !keys.includes(field.columns.id)) continue
    const object = row[field.columns.object] ?? null
    const id = row[field.columns.id] ?? null
    if (object === null && id === null) continue
    if (typeof object !== 'string' || typeof id !== 'string') throw new ApiError(400, 'invalid', `${field.label}はテーブル名と ID を組で指定してください`)
    if (!field.targets?.includes(object)) throw new ApiError(400, 'invalid', `${field.label}に ${object} は指定できません`)
    if (!table(object).some((r) => r.id === id)) throw new ApiError(400, 'invalid', `${field.label}の参照先が見つかりません`)
  }
}

/**
 * 定義に無い列が本文にあれば 400(04 §11)。黙って捨てると、MCP や AI チャットが項目名を間違えたときに
 * 値が消えたことに気づけない。DB(PostgreSQL)も無い列への INSERT は弾くので、モックも同じにする。
 * readonly の列(`completed_at` など)は本文にあってよい(移行で元の日時を保つ)。`id` はサーバが付ける
 */
function rejectUnknownColumns(meta: ObjectMeta, values: Record<string, Scalar>) {
  const known = new Set<string>()
  for (const field of meta.fields) {
    if (field.type === 'polymorphic' && field.columns) {
      known.add(field.columns.object)
      known.add(field.columns.id)
    } else {
      known.add(field.key)
    }
  }
  const bad = Object.keys(values).find((k) => !known.has(k))
  if (bad !== undefined) throw new ApiError(400, 'invalid', `定義に無い列です: ${bad}`)
}

export function insert(object: string, values: Record<string, Scalar>, me: string | null) {
  const meta = objectMeta(object)
  rejectUnknownColumns(meta, values)
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
  // 活動の日付は今日(必須の検証より先に埋める。Web フォームや MCP から日付を省いても通る)
  if (meta.timeline) defaults[meta.timeline.date] = localDateOf(now)
  const effective = { ...defaults, ...values }
  Object.assign(row, effective)
  validate(meta, row, null)
  row.created_at = now
  applyRules(meta, null, row, effective, me)
  table(object).unshift(row)
  save()
  return find(object, row.id)!
}

export function update(object: string, id: string, patch: Record<string, Scalar>, me: string | null) {
  const meta = objectMeta(object)
  const rows = table(object)
  const index = rows.findIndex((r) => r.id === id)
  if (index < 0) return null
  rejectUnknownColumns(meta, patch)
  const next = { ...rows[index], ...patch, id }
  validate(meta, next, Object.keys(patch))
  applyRules(meta, rows[index], next, patch, me)
  rows[index] = next
  applyRecurrence(meta, next, rows, index, patch, me)
  save()
  return find(object, id)!
}

/**
 * 繰り返し(Todoist の型)。完了したとき、規則(repeat)があれば:
 * - その回は完了済みの行として残る(時系列に出る)
 * - 次回のタスクを作る。期限は「元の期限から」(every)か「完了した日から」(every!)規則ぶん進める。前回(repeat_of)で繋ぐ
 * 完了を戻したとき: 自動で作った次回(まだ未着手のもの)を消す。だから「戻すと次回が消える」
 */
function applyRecurrence(meta: ObjectMeta, row: Row, rows: Row[], index: number, patch: Record<string, Scalar>, me: string | null) {
  const c = meta.completion
  if (!c?.repeat_field || !(c.field in patch)) return
  const dueKey = c.due_field ?? meta.fields.find((f) => f.semantic === 'deadline')?.key
  const rule = row[c.repeat_field]
  const isDone = row[c.field] === c.done_value
  if (isDone) {
    if (typeof rule !== 'string' || !rule || !dueKey || typeof row[dueKey] !== 'string') return
    const fromCompletion = Boolean(c.repeat_from_completion_field && row[c.repeat_from_completion_field])
    const base = fromCompletion ? localDateOf(new Date().toISOString()) : String(row[dueKey])
    const due = nextDue(base, rule)
    if (!due) return
    // 既に次回がある(二重に完了を送った)なら作らない
    if (c.repeat_of_field && rows.some((r) => r[c.repeat_of_field!] === row.id)) return
    const copy: Record<string, Scalar> = {}
    for (const f of meta.fields) {
      if (f.readonly || f.type === 'polymorphic' || f.key === c.field || f.key === c.completed_at_field) continue
      copy[f.key] = row[f.key] ?? null
    }
    for (const f of meta.fields) if (f.type === 'polymorphic' && f.columns) {
      copy[f.columns.object] = row[f.columns.object] ?? null
      copy[f.columns.id] = row[f.columns.id] ?? null
    }
    copy[dueKey] = due
    copy[c.field] = c.open_value
    if (c.repeat_of_field) copy[c.repeat_of_field] = row.id
    // 作成と同じ経路(既定値・検証・業務ルール)。rows の先頭に入るので、index の行はそのまま
    insert(meta.key, copy, me)
    void index
  } else if (c.repeat_of_field) {
    // 完了を戻した: この回から自動で作った次回が、まだ未着手ならば消す
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]
      if (r[c.repeat_of_field] === row.id && r[c.field] === c.open_value) rows.splice(i, 1)
    }
  }
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
  const ctx = defaultContext(me, workspace.timezone)
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
      else if (polymorphic) label = liveObjects().find((o) => o.key === key)?.label ?? key
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
  for (const meta of liveObjects().sort((a, b) => a.position - b.position)) {
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

// --- テーブル設定 ---------------------------------------------------------------

export function getMeta(): MetaResponse {
  return schema.visibleMeta()
}

export function createObject(input: ObjectInput): MetaResponse {
  const { purged } = schema.createObject(input)
  if (purged) delete tables[purged]
  tables[input.key] = []
  save()
  return schema.visibleMeta()
}

export function updateObject(key: string, input: ObjectInput): MetaResponse {
  schema.updateObject(key, input)
  return schema.visibleMeta()
}

export function deleteObject(key: string): MetaResponse {
  schema.deleteObject(key)
  return schema.visibleMeta()
}

export function reorderObjects(keys: string[]): MetaResponse {
  schema.reorderObjects(keys)
  return schema.visibleMeta()
}

export function createView(object: string, input: ViewInput): MetaResponse {
  schema.createView(object, input)
  return schema.visibleMeta()
}

export function updateView(id: string, input: ViewInput): MetaResponse {
  schema.updateView(id, input)
  return schema.visibleMeta()
}

export function deleteView(id: string): MetaResponse {
  schema.deleteView(id)
  return schema.visibleMeta()
}

export function restoreView(id: string): MetaResponse {
  schema.restoreView(id)
  return schema.visibleMeta()
}

export function reorderViews(object: string, ids: string[]): MetaResponse {
  schema.reorderViews(object, ids)
  return schema.visibleMeta()
}

export function restoreObject(key: string): MetaResponse {
  schema.restoreObject(key)
  return schema.visibleMeta()
}

// --- 時系列 -------------------------------------------------------------------

/** 素の文字(タスクの詳細)を段落にする */
function paragraphs(text: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => `<p>${esc(l)}</p>`)
    .join('')
}

/** あるレコードを「関連先」の列(polymorphic か relation)で指している行か */
function pointsTo(meta: ObjectMeta, row: Row, object: string, id: string): boolean {
  return meta.fields.some((f) => {
    if (f.type === 'polymorphic' && f.columns) return row[f.columns.object] === object && row[f.columns.id] === id
    return f.type === 'relation' && f.target === object && row[f.key] === id
  })
}

/**
 * レコードの時系列: 活動(関連先がそのレコード)+ 言及された活動 + 完了したタスク。
 * 完了したタスクは活動に複製せず、ここで合成する。だから初めから完了していたデータや、あとから取り込んだデータも出る
 */
export function timeline(object: string, id: string): TimelineEntry[] {
  objectMeta(object)
  const entries: TimelineEntry[] = []
  const nameOf = (o: string, i: string) => refOf(o, i)?.name ?? ''
  for (const meta of liveObjects()) {
    if (meta.timeline) {
      const t = meta.timeline
      const typeField = meta.fields.find((f) => f.key === t.type)
      const related = meta.fields.find((f) => f.type === 'polymorphic')
      const userField = meta.fields.find((f) => f.type === 'user')
      for (const row of table(meta.key)) {
        const direct = pointsTo(meta, row, object, id)
        const mentioned = typeof row.mentions === 'string' && row.mentions.includes(`"${object}:${id}"`)
        if (!direct && !mentioned) continue
        const relObject = related?.columns ? row[related.columns.object] : null
        const relId = related?.columns ? row[related.columns.id] : null
        entries.push({
          kind: direct ? 'activity' : 'mention',
          object: meta.key,
          id: row.id,
          date: String(row[t.date] ?? ''),
          at: String(row.created_at ?? ''),
          subject: String(row[t.subject] ?? ''),
          type: typeField?.options?.find((o) => o.value === row[t.type]) ?? null,
          body: typeof row[t.body] === 'string' ? String(row[t.body]) : null,
          user_id: userField && typeof row[userField.key] === 'string' ? String(row[userField.key]) : null,
          related: typeof relObject === 'string' && typeof relId === 'string' ? { object: relObject, id: relId, name: nameOf(relObject, relId) } : null,
        })
      }
    } else if (meta.completion && meta.key !== object) {
      const c = meta.completion
      const userField = meta.fields.find((f) => f.type === 'user')
      const bodyField = meta.fields.find((f) => f.type === 'textarea' || f.type === 'richtext')
      for (const row of table(meta.key)) {
        if (row[c.field] !== c.done_value || !pointsTo(meta, row, object, id)) continue
        const at = c.completed_at_field && typeof row[c.completed_at_field] === 'string' ? String(row[c.completed_at_field]) : String(row.updated_at ?? '')
        const raw = bodyField ? row[bodyField.key] : null
        entries.push({
          kind: 'completion',
          object: meta.key,
          id: row.id,
          date: at ? localDateOf(at) : '',
          at,
          subject: String(row[meta.name_field] ?? ''),
          body: typeof raw === 'string' && raw ? (bodyField?.type === 'richtext' ? raw : paragraphs(raw)) : null,
          user_id: userField && typeof row[userField.key] === 'string' ? String(row[userField.key]) : null,
          related: null,
        })
      }
    }
  }
  entries.sort((a, b) => (a.date === b.date ? (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) : a.date < b.date ? 1 : -1))
  return structuredClone(entries.slice(0, 100))
}
