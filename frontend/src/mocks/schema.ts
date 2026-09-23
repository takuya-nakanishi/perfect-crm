/**
 * メタデータ(テーブル・項目・ビューの定義)の擬似 DB。テーブル設定の画面からの変更をここで受ける。
 * 本番では meta_objects / meta_fields / meta_views への書き込みと、実テーブルの DDL に当たる。
 *
 * 決まり:
 * - 削除は論理削除。テーブルを消してもレコードとビューは残り、項目を外しても列の値は残る(同じ列名で戻せば復活する)
 * - 無くなった項目やテーブルを指している定義は、保存してある形を壊さず、返すとき(visibleMeta)に外す。
 *   だから「元に戻す」は、前の定義をもう一度保存するだけで済む
 */
import { ApiError } from '@/api/client'
import type { FieldInput, FieldMeta, FieldType, Filter, MetaResponse, ObjectInput, ObjectMeta, TagColor, User, ViewInput, ViewMeta, Workspace } from '@/api/types'
import objectsJson from './fixtures/objects.json'
import usersJson from './fixtures/users.json'
import viewsJson from './fixtures/views.json'
import workspaceJson from './fixtures/workspace.json'

const STORAGE_KEY = 'works.mock.schema.v1'

export const users = usersJson as User[]
export const workspace = workspaceJson.workspace as Workspace

interface Schema {
  objects: ObjectMeta[]
  views: ViewMeta[]
  /** 論理削除したテーブルの key */
  trashed: string[]
  /** 論理削除したビューの id */
  trashedViews?: string[]
  /** 外した項目の定義(テーブル名 → 列名 → 定義)。同じ列名で戻したら、これを復活させる(型を変えての再利用を防ぐ) */
  removedFields?: Record<string, Record<string, FieldMeta>>
}

function seed(): Schema {
  return structuredClone({ objects: objectsJson as ObjectMeta[], views: viewsJson as ViewMeta[], trashed: [] })
}

function load(): Schema {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved) as Schema
  } catch {
    // 壊れていたら作り直す
  }
  return seed()
}

let schema: Schema = load()

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(schema))
  } catch {
    // 保存できなくても画面は動かす
  }
}

export function resetSchema() {
  localStorage.removeItem(STORAGE_KEY)
  schema = seed()
}

/** 定義そのまま(論理削除したテーブルも引ける。残っているレコードの表示名を解決するため) */
export function objectMeta(key: string): ObjectMeta {
  const meta = schema.objects.find((o) => o.key === key)
  if (!meta) throw new ApiError(404, 'not_found', `テーブルがありません: ${key}`)
  return meta
}

const isLive = (key: string | undefined) => Boolean(key) && schema.objects.some((o) => o.key === key) && !schema.trashed.includes(key!)

/** いま使えるテーブル。消えたテーブルを指す参照の項目は外して返す */
export function liveObjects(): ObjectMeta[] {
  return schema.objects
    .filter((o) => !schema.trashed.includes(o.key))
    .map((o) => ({
      ...o,
      fields: o.fields
        .filter((f) => f.type !== 'relation' || isLive(f.target))
        .map((f) => (f.type === 'polymorphic' ? { ...f, targets: f.targets?.filter(isLive) } : f)),
    }))
}

/** 無くなった項目を指している部分を外したビュー。成り立たなくなったもの(分ける列の無いカンバン)は null */
/**
 * 無い項目を指す条件を外す。外すと条件が緩んで表示が広がるので、02 §5 の決まりとして明記している。
 * and / or が空になれば、その群ごと外す
 */
function cleanFilter(filter: Filter | undefined, has: (key: string | undefined) => boolean): Filter | undefined {
  if (!filter) return undefined
  if ('and' in filter || 'or' in filter) {
    const parts = ('and' in filter ? filter.and : filter.or).map((p) => cleanFilter(p, has)).filter((p): p is Filter => Boolean(p))
    if (parts.length === 0) return undefined
    return 'and' in filter ? { and: parts } : { or: parts }
  }
  return has(filter.field) ? filter : undefined
}

function cleanView(view: ViewMeta, object: ObjectMeta): ViewMeta | null {
  // polymorphic は、論理名(related)と実際の 2 列(related_object・related_id)のどちらでも指せる。
  // ビューの列は論理名で、レポートの分け方は related_object で指す
  const columns = object.fields.flatMap((f) => (f.columns ? [f.key, f.columns.object, f.columns.id] : [f.key]))
  const has = (key: string | undefined) => key !== undefined && columns.includes(key)
  if (view.type === 'list') {
    return {
      ...view,
      config: { ...view.config, columns: view.config.columns.filter((c) => has(c.field)), sort: view.config.sort?.filter((s) => has(s.field)), filter: cleanFilter(view.config.filter, has) },
    }
  }
  if (view.type === 'kanban') {
    if (!has(view.config.group_by)) return null
    return {
      ...view,
      config: {
        ...view.config,
        card_fields: view.config.card_fields.filter(has),
        sum_field: has(view.config.sum_field) ? view.config.sum_field : undefined,
        sort: view.config.sort?.filter((s) => has(s.field)),
        filter: cleanFilter(view.config.filter, has),
      },
    }
  }
  const widgets = view.config.widgets.filter((w) => {
    const used = [w.measure.field, w.measure.weight_field, w.type === 'stat' ? undefined : w.group_by.field].filter((k): k is string => Boolean(k))
    return used.every(has)
  })
  return widgets.length > 0 ? { ...view, config: { widgets } } : null
}

/** GET /meta の応答 */
export function visibleMeta(): MetaResponse {
  const objects = liveObjects()
  const views = schema.views.flatMap((v) => {
    if (schema.trashedViews?.includes(v.id)) return []
    const object = objects.find((o) => o.key === v.object)
    const cleaned = object ? cleanView(v, object) : null
    return cleaned ? [cleaned] : []
  })
  return structuredClone({ workspace, objects, views, users })
}

// --- 検証 -------------------------------------------------------------------

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/
const RESERVED_FIELD_KEYS = new Set(['id', 'created_at', 'updated_at'])
const RESERVED_OBJECT_KEYS = new Set(['users', 'meta', 'session', 'search'])
/** 画面から足せる型。polymorphic は初めから入っているテーブルだけが持つ */
const CREATABLE: FieldType[] = ['text', 'textarea', 'richtext', 'number', 'currency', 'percent', 'date', 'datetime', 'select', 'multi_select', 'checkbox', 'email', 'phone', 'url', 'relation', 'user', 'drive_files']
const TEXT_TYPES = new Set<FieldType>(['text', 'textarea', 'richtext', 'email', 'phone', 'url'])
const TAG_COLORS: TagColor[] = ['gray', 'green', 'teal', 'blue', 'violet', 'pink', 'red', 'orange', 'amber']

function invalid(message: string): never {
  throw new ApiError(400, 'invalid', message)
}

/** 入力から 1 項目の定義を作る。既にある項目は、画面から決められない属性(semantic など)を引き継ぐ */
function buildField(input: FieldInput, existing: FieldMeta | undefined): FieldMeta {
  const label = input.label.trim()
  if (!label) invalid('項目名を入力してください')
  if (!KEY_PATTERN.test(input.key)) invalid(`「${label}」の列名は、小文字の英字で始め、英数字と _ で書いてください`)
  if (RESERVED_FIELD_KEYS.has(input.key)) invalid(`列名 ${input.key} はシステムが使っています`)
  if (existing && existing.type !== input.type) invalid(`「${label}」の型は変えられません`)
  if (!existing && !CREATABLE.includes(input.type)) invalid(`「${label}」の型は選べません`)

  const field: FieldMeta = { ...existing, key: input.key, label, type: input.type }
  if (input.required) field.required = true
  else delete field.required

  delete field.max_length
  delete field.scale
  if (TEXT_TYPES.has(input.type) && input.max_length != null) {
    if (!Number.isInteger(input.max_length) || input.max_length < 1 || input.max_length > 100000) invalid(`「${label}」の桁数は 1 以上の整数で指定してください`)
    field.max_length = input.max_length
  }
  if ((input.type === 'number' || input.type === 'percent') && input.scale != null) {
    if (!Number.isInteger(input.scale) || input.scale < 0 || input.scale > 6) invalid(`「${label}」の小数の桁数は 0〜6 で指定してください`)
    field.scale = input.scale
  }

  const placeholder = input.placeholder?.trim()
  if (placeholder) field.placeholder = placeholder
  else delete field.placeholder

  if (input.type === 'select' || input.type === 'multi_select') {
    const options = (input.options ?? []).map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label)
    if (options.length === 0) invalid(`「${label}」に選択肢を 1 つ以上入れてください`)
    if (new Set(options.map((o) => o.value)).size !== options.length) invalid(`「${label}」の選択肢が重なっています`)
    for (const o of options) if (!TAG_COLORS.includes(o.color)) invalid(`「${label}」の選択肢の色が正しくありません`)
    // 画面から決められない属性(kind・probability)は、同じ value の既存の選択肢から引き継ぐ(本文に無ければ元のまま。04 §6)
    field.options = options.map((o) => {
      const prev = existing?.options?.find((e) => e.value === o.value)
      return prev ? { ...prev, ...o } : o
    })
  }
  if (input.type === 'relation') {
    if (existing) field.target = existing.target
    else if (!isLive(input.target)) invalid(`「${label}」の参照先のテーブルを選んでください`)
    else field.target = input.target
  }
  return field
}

function checkObjectInput(input: ObjectInput) {
  if (!input.label.trim()) invalid('テーブル名を入力してください')
  if (!TAG_COLORS.includes(input.color)) invalid('色が正しくありません')
  const keys = input.fields.map((f) => f.key)
  const dup = keys.find((k, i) => keys.indexOf(k) !== i)
  if (dup) invalid(`列名 ${dup} が重なっています`)
}

const SYSTEM_FIELDS: FieldMeta[] = [
  { key: 'created_at', label: '作成日時', type: 'datetime', readonly: true },
  { key: 'updated_at', label: '更新日時', type: 'datetime', readonly: true },
]

// --- 既定のビュー -------------------------------------------------------------

const COLUMN_WIDTH: Partial<Record<FieldType, number>> = { relation: 200, email: 220, url: 200, phone: 150, checkbox: 90, datetime: 140, textarea: 240 }

/**
 * ビューを画面から編集する機能がまだ無いので、テーブル設定の結果が見えるようにサーバが面倒を見る:
 * - 一覧が無ければ作る。足した項目は、先頭の一覧の列に加える
 * - カンバンが無く、選択肢の項目があれば、その項目で分けるカンバンを作る
 */
function ensureViews(object: ObjectMeta, added: FieldMeta[]) {
  const mine = schema.views.filter((v) => v.object === object.key).sort((a, b) => a.position - b.position)
  const column = (f: FieldMeta) => ({ field: f.key, width: f.key === object.name_field ? 280 : (COLUMN_WIDTH[f.type] ?? 140) })
  const list = mine.find((v) => v.type === 'list')
  if (!list) {
    const columns = object.fields.filter((f) => !f.readonly && f.type !== 'textarea').slice(0, 7).map(column)
    schema.views.push({
      id: crypto.randomUUID(),
      object: object.key,
      type: 'list',
      name: '一覧',
      position: 1,
      config: { columns: [...columns, { field: 'updated_at', width: 140 }], sort: [{ field: 'updated_at', dir: 'desc' }] },
    })
  } else if (list.type === 'list') {
    const stamps = list.config.columns.filter((c) => SYSTEM_FIELDS.some((s) => s.key === c.field))
    const rest = list.config.columns.filter((c) => !stamps.includes(c))
    const fresh = added.filter((f) => f.type !== 'textarea' && !rest.some((c) => c.field === f.key)).map(column)
    list.config.columns = [...rest, ...fresh, ...stamps]
  }
  const groupBy = object.fields.find((f) => f.type === 'select' && !f.readonly)
  if (groupBy && !mine.some((v) => v.type === 'kanban')) {
    const cards = object.fields.filter((f) => !f.readonly && f.key !== object.name_field && f.key !== groupBy.key && f.type !== 'textarea')
    schema.views.push({
      id: crypto.randomUUID(),
      object: object.key,
      type: 'kanban',
      name: 'カンバン',
      position: Math.max(1, ...mine.map((v) => v.position)) + 1,
      config: {
        group_by: groupBy.key,
        card_fields: cards.slice(0, 3).map((f) => f.key),
        sum_field: cards.find((f) => f.type === 'currency')?.key,
        sort: [{ field: 'updated_at', dir: 'desc' }],
      },
    })
  }
}

// --- 公開する操作 --------------------------------------------------------------

/** 返り値の purged は、同じ key の削除済みテーブルを上書きしたときの key(呼び出し側がレコードを捨てる) */
export function createObject(input: ObjectInput): { purged: string | null } {
  checkObjectInput(input)
  if (!KEY_PATTERN.test(input.key)) invalid('テーブルの列名は、小文字の英字で始め、英数字と _ で書いてください')
  if (RESERVED_OBJECT_KEYS.has(input.key)) invalid(`${input.key} はシステムが使っています`)
  if (isLive(input.key)) invalid(`${input.key} という名前のテーブルは既にあります`)
  if (input.fields.length === 0) invalid('項目を 1 つ以上入れてください')
  if (input.fields[0].type !== 'text') invalid('先頭の項目はレコードの表示名になるので、文字(1 行)にしてください')

  // 削除済みの同名テーブルがあれば、作らせない(復元できる保証を守る。完全に捨てるのは別の操作。02 §5)
  if (schema.trashed.includes(input.key)) invalid(`${input.key} は削除済みのテーブルにあります。元に戻すか、別の列名にしてください`)
  const purged = null

  const fields = input.fields.map((f, i) => buildField(i === 0 ? { ...f, required: true } : f, undefined))
  const object: ObjectMeta = {
    key: input.key,
    label: input.label.trim(),
    icon: input.icon,
    color: input.color,
    name_field: fields[0].key,
    subtitle_field: fields.find((f) => f.type === 'select')?.key,
    position: Math.max(0, ...schema.objects.map((o) => o.position)) + 1,
    in_sidebar: input.in_sidebar ?? true,
    fields: [...fields, ...structuredClone(SYSTEM_FIELDS)],
  }
  schema.objects.push(object)
  // 「全テーブルを指せる」関連先(活動)には、新しいテーブルも加える
  for (const o of schema.objects) {
    for (const f of o.fields) if (f.type === 'polymorphic' && f.all_targets && f.targets && !f.targets.includes(object.key)) f.targets.push(object.key)
  }
  ensureViews(object, [])
  save()
  return { purged }
}

/** 外せない項目か(表示名、システムの列、業務ルールが使う列、関連先) */
export function isProtectedField(object: ObjectMeta, field: FieldMeta): boolean {
  const c = object.completion
  const t = object.timeline
  return Boolean(
    field.key === object.name_field ||
      field.readonly ||
      field.locked ||
      field.type === 'polymorphic' ||
      field.key === c?.field ||
      field.key === c?.completed_at_field ||
      (t && [t.subject, t.type, t.date, t.body].includes(field.key)),
  )
}

export function updateObject(key: string, input: ObjectInput) {
  if (!isLive(key)) throw new ApiError(404, 'not_found', `テーブルがありません: ${key}`)
  checkObjectInput(input)
  const object = objectMeta(key)
  const editable = object.fields.filter((f) => !f.readonly)
  const missing = editable.find((f) => isProtectedField(object, f) && !input.fields.some((i) => i.key === f.key))
  if (missing) invalid(`「${missing.label}」は外せません`)
  const name = input.fields.find((f) => f.key === object.name_field)
  if (name && !name.required) name.required = true

  const removed = (schema.removedFields ??= {})[key] ?? {}
  const added: FieldMeta[] = []
  const fields = input.fields.map((f) => {
    // 外した項目を同じ列名で戻したら、元の定義を復活させる(型が違えば 400。列の値が別の型として読まれるのを防ぐ)
    const existing = editable.find((e) => e.key === f.key) ?? removed[f.key]
    const built = buildField(f, existing)
    if (!editable.some((e) => e.key === f.key)) added.push(built)
    return built
  })
  // 参照先が削除中で GET /meta から隠れている項目は、全量置換の本文に無くても外さない(隠れているだけ)
  const hidden = editable.filter((f) => !liveField(f) && !input.fields.some((i) => i.key === f.key))
  // 外した項目は保管する(戻せるように)。戻した項目は保管庫から出す
  const next = new Set([...fields, ...hidden].map((f) => f.key))
  for (const f of editable) if (!next.has(f.key)) removed[f.key] = structuredClone(f)
  for (const f of fields) delete removed[f.key]
  schema.removedFields[key] = removed

  // 業務ルールが前提にする選択肢(完了の done / open)は消せない
  const c = object.completion
  if (c) {
    const status = fields.find((f) => f.key === c.field)
    for (const v of [c.done_value, c.open_value]) if (!status?.options?.some((o) => o.value === v)) invalid(`「${status?.label ?? c.field}」の選択肢 ${v} は、完了の仕組みが使うので外せません`)
  }

  object.label = input.label.trim()
  object.icon = input.icon
  object.color = input.color
  if (input.in_sidebar !== undefined) object.in_sidebar = input.in_sidebar
  object.fields = [...fields, ...hidden, ...object.fields.filter((f) => f.readonly)]
  if (object.subtitle_field && !fields.some((f) => f.key === object.subtitle_field)) delete object.subtitle_field
  ensureViews(object, added)
  save()
}

/** GET /meta で見えている項目か(参照先が削除中の relation は隠れる) */
function liveField(f: FieldMeta): boolean {
  return f.type !== 'relation' || isLive(f.target)
}

/** 渡した順に先頭から並べ、渡さなかったテーブル(サイドバーに出していないもの)は元の順で後ろに続ける */
export function reorderObjects(keys: string[]) {
  const live = liveObjects()
  if (keys.some((k) => !live.some((o) => o.key === k))) invalid('無いテーブルが含まれています')
  const rest = live.filter((o) => !keys.includes(o.key)).sort((a, b) => a.position - b.position).map((o) => o.key)
  ;[...keys, ...rest].forEach((k, i) => {
    objectMeta(k).position = i + 1
  })
  save()
}

export function deleteObject(key: string) {
  if (!isLive(key)) throw new ApiError(404, 'not_found', `テーブルがありません: ${key}`)
  if (objectMeta(key).system) invalid('初めから入っているテーブルは削除できません')
  schema.trashed.push(key)
  save()
}

export function restoreObject(key: string) {
  if (!schema.trashed.includes(key)) throw new ApiError(404, 'not_found', `削除済みのテーブルがありません: ${key}`)
  schema.trashed = schema.trashed.filter((k) => k !== key)
  save()
}

// --- ビュー ---------------------------------------------------------------------

function viewOf(id: string): ViewMeta {
  const view = schema.views.find((v) => v.id === id)
  if (!view || schema.trashedViews?.includes(id)) throw new ApiError(404, 'not_found', 'ビューがありません')
  return view
}

/** 画面から来た定義を確かめる。無い項目を指していたら 400(画面は同じ規則で先に弾く) */
function checkViewInput(object: ObjectMeta, input: ViewInput) {
  const name = input.name.trim()
  if (!name) invalid('ビューの名前を入力してください')
  const has = (key: string | undefined) => key !== undefined && object.fields.some((f) => f.key === key)
  const checkFilter = (f: Filter | undefined): void => {
    if (!f) return
    if ('and' in f) return f.and.forEach(checkFilter)
    if ('or' in f) return f.or.forEach(checkFilter)
    // polymorphic の「どのテーブルか」の列も条件に書ける
    const columns = object.fields.flatMap((x) => (x.columns ? [x.columns.object, x.columns.id] : []))
    if (!has(f.field) && !columns.includes(f.field)) invalid(`条件の項目がありません: ${f.field}`)
  }
  if (input.type === 'list') {
    if (input.config.columns.length === 0) invalid('表示する項目を 1 つ以上選んでください')
    for (const c of input.config.columns) if (!has(c.field)) invalid(`項目がありません: ${c.field}`)
  } else if (input.type === 'kanban') {
    const g = object.fields.find((f) => f.key === input.config.group_by)
    if (!g || g.type !== 'select') invalid('カンバンで分ける項目には、選択肢の項目を選んでください')
    for (const k of input.config.card_fields) if (!has(k)) invalid(`項目がありません: ${k}`)
    if (input.config.sum_field !== undefined && !has(input.config.sum_field)) invalid('合計する項目がありません')
  }
  if (input.type !== 'report') {
    checkFilter(input.config.filter)
    for (const s of input.config.sort ?? []) if (!has(s.field)) invalid(`並び替えの項目がありません: ${s.field}`)
  }
  if (input.pin && !input.pin.label.trim()) invalid('お気に入りの名前を入力してください')
}

export function createView(object: string, input: ViewInput): string {
  if (!isLive(object)) throw new ApiError(404, 'not_found', `テーブルがありません: ${object}`)
  const meta = objectMeta(object)
  checkViewInput(meta, input)
  const mine = schema.views.filter((v) => v.object === object && !schema.trashedViews?.includes(v.id))
  const view = {
    ...structuredClone(input),
    id: crypto.randomUUID(),
    object,
    name: input.name.trim(),
    position: Math.max(0, ...mine.map((v) => v.position)) + 1,
  } as ViewMeta
  if (view.pin) view.pin = { ...view.pin, position: Math.max(0, ...schema.views.map((v) => v.pin?.position ?? 0)) + 1 }
  schema.views.push(view)
  save()
  return view.id
}

export function updateView(id: string, input: ViewInput) {
  const current = viewOf(id)
  const meta = objectMeta(current.object)
  checkViewInput(meta, input)
  const next = { ...structuredClone(input), id, object: current.object, position: current.position, name: input.name.trim() } as ViewMeta
  // お気に入りの並びは、既にあればそのまま。新しく付けたら末尾
  if (next.pin) next.pin = { ...next.pin, position: current.pin?.position ?? Math.max(0, ...schema.views.map((v) => v.pin?.position ?? 0)) + 1 }
  schema.views[schema.views.findIndex((v) => v.id === id)] = next
  save()
}

export function deleteView(id: string) {
  const view = viewOf(id)
  const rest = schema.views.filter((v) => v.object === view.object && v.id !== id && !schema.trashedViews?.includes(v.id))
  if (rest.length === 0) invalid('最後のビューは削除できません')
  ;(schema.trashedViews ??= []).push(id)
  save()
}

export function restoreView(id: string) {
  if (!schema.trashedViews?.includes(id)) throw new ApiError(404, 'not_found', '削除済みのビューがありません')
  schema.trashedViews = schema.trashedViews.filter((v) => v !== id)
  save()
}

export function reorderViews(object: string, ids: string[]) {
  const mine = schema.views.filter((v) => v.object === object && !schema.trashedViews?.includes(v.id)).map((v) => v.id)
  if (ids.length !== mine.length || ids.some((i) => !mine.includes(i))) invalid('並びには、そのテーブルのビューを全部含めてください')
  ids.forEach((id, i) => {
    viewOf(id).position = i + 1
  })
  save()
}
