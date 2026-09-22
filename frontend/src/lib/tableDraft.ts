import type { FieldMeta, FieldType, MetaResponse, ObjectInput, ObjectMeta, SelectOption, TagColor } from '@/api/types'

/**
 * テーブル設定の下書き。保存するまでサーバには何も送らない。
 * ここでの検証は、打っている最中にその場で伝えるためのもの。最後の判断はサーバがする(同じ規則を 400 で返す)
 */
export interface DraftField {
  /** 画面の中だけの ID(並べ替えと React の key に使う) */
  uid: string
  key: string
  /** 列名を手で直したか。直していなければ、項目名に合わせて付け直す */
  keyTouched: boolean
  isNew: boolean
  label: string
  type: FieldType
  required: boolean
  max_length: number | null
  scale: number | null
  placeholder: string
  options: SelectOption[]
  target: string | null
  /** レコードの表示名になる項目(先頭に固定、文字・必須) */
  isName: boolean
  /** 外せず、型も変えられない項目(業務ルールが使う列、関連先) */
  isProtected: boolean
}

export interface TableDraft {
  mode: 'create' | 'edit'
  key: string
  keyTouched: boolean
  label: string
  icon: string
  color: TagColor
  system: boolean
  in_sidebar: boolean
  fields: DraftField[]
}

export const TAG_COLORS: TagColor[] = ['gray', 'green', 'teal', 'blue', 'violet', 'pink', 'red', 'orange', 'amber']
export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  gray: '灰',
  green: '緑',
  teal: '青緑',
  blue: '青',
  violet: '紫',
  pink: '桃',
  red: '赤',
  orange: '橙',
  amber: '琥珀',
}

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/
const RESERVED = new Set(['id', 'created_at', 'updated_at'])
export const TEXT_TYPES = new Set<FieldType>(['text', 'textarea', 'richtext', 'email', 'phone', 'url'])
export const SCALE_TYPES = new Set<FieldType>(['number', 'percent'])

let uidSeq = 0
const uid = () => `f${++uidSeq}`

/** 英数字の名前ならそこから、和文なら連番で列名を作る(和文はローマ字にできないので) */
function slug(label: string): string | null {
  const s = label
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return /^[a-z]/.test(s) && s.length >= 2 ? s.slice(0, 40) : null
}

function nextFree(prefix: string, taken: Set<string>): string {
  for (let n = 1; ; n++) if (!taken.has(`${prefix}_${n}`)) return `${prefix}_${n}`
}

export function autoFieldKey(label: string, fields: DraftField[], self: DraftField): string {
  const taken = new Set([...fields.filter((f) => f.uid !== self.uid).map((f) => f.key), ...RESERVED])
  const base = slug(label)
  if (base && !taken.has(base)) return base
  // 連番は、いちど付けたらそのまま(打つたびに変わらない)
  return /^field_\d+$/.test(self.key) && !taken.has(self.key) ? self.key : nextFree(base ?? 'field', taken)
}

export function autoTableKey(label: string, meta: MetaResponse, current: string): string {
  const taken = new Set(meta.objects.map((o) => o.key))
  const base = slug(label)
  if (base && !taken.has(base)) return base
  return /^table_\d+$/.test(current) && !taken.has(current) ? current : nextFree(base ?? 'table', taken)
}

export function newField(fields: DraftField[], init: Partial<DraftField> = {}): DraftField {
  const field: DraftField = {
    uid: uid(),
    key: '',
    keyTouched: false,
    isNew: true,
    label: '',
    type: 'text',
    required: false,
    max_length: null,
    scale: null,
    placeholder: '',
    options: [],
    target: null,
    isName: false,
    isProtected: false,
    ...init,
  }
  field.key ||= autoFieldKey(field.label, fields, field)
  return field
}

export function newOption(options: SelectOption[], label = ''): SelectOption {
  const taken = new Set(options.map((o) => o.value))
  // 灰は「未設定」に見えるので、最初の色は緑から回す
  return { value: nextFree('option', taken), label, color: TAG_COLORS[(options.length % (TAG_COLORS.length - 1)) + 1] }
}

export function blankDraft(meta: MetaResponse): TableDraft {
  const name = newField([], { label: '名前', isName: true, required: true, key: 'name', max_length: 255 })
  return { mode: 'create', key: autoTableKey('', meta, ''), keyTouched: false, label: '', icon: 'table-2', color: 'teal', system: false, in_sidebar: true, fields: [name] }
}

function isProtected(object: ObjectMeta, f: FieldMeta): boolean {
  const c = object.completion
  return Boolean(f.locked || f.type === 'polymorphic' || f.key === c?.field || f.key === c?.completed_at_field)
}

export function draftOf(object: ObjectMeta): TableDraft {
  return {
    mode: 'edit',
    key: object.key,
    keyTouched: true,
    label: object.label,
    icon: object.icon,
    color: object.color,
    system: Boolean(object.system),
    in_sidebar: object.in_sidebar,
    fields: object.fields
      .filter((f) => !f.readonly)
      .map((f) => ({
        uid: uid(),
        key: f.key,
        keyTouched: true,
        isNew: false,
        label: f.label,
        type: f.type,
        required: Boolean(f.required),
        max_length: f.max_length ?? null,
        scale: f.scale ?? null,
        placeholder: f.placeholder ?? '',
        options: structuredClone(f.options ?? []),
        target: f.target ?? null,
        isName: f.key === object.name_field,
        isProtected: isProtected(object, f),
      })),
  }
}

/** 名前を入れていない新しい行は、書きかけとして数えない(表計算の末尾の空行と同じ扱い) */
export const isBlankRow = (f: DraftField) => f.isNew && !f.label.trim() && !f.isName

export function toInput(draft: TableDraft): ObjectInput {
  return {
    key: draft.key,
    label: draft.label.trim(),
    icon: draft.icon,
    color: draft.color,
    in_sidebar: draft.in_sidebar,
    fields: draft.fields
      .filter((f) => !isBlankRow(f))
      .map((f) => ({
        key: f.key,
        label: f.label.trim(),
        type: f.type,
        required: f.required || f.isName,
        max_length: TEXT_TYPES.has(f.type) ? (f.max_length ?? undefined) : undefined,
        scale: SCALE_TYPES.has(f.type) ? (f.scale ?? undefined) : undefined,
        placeholder: f.placeholder.trim() || undefined,
        options: f.type === 'select' || f.type === 'multi_select' ? f.options.filter((o) => o.label.trim()).map((o) => ({ ...o, label: o.label.trim() })) : undefined,
        target: f.type === 'relation' ? (f.target ?? undefined) : undefined,
      })),
  }
}

export interface DraftErrors {
  label?: string
  key?: string
  /** uid → その項目の不備(最初の 1 つ) */
  fields: Record<string, string>
  count: number
}

export function validateDraft(draft: TableDraft, meta: MetaResponse): DraftErrors {
  const errors: DraftErrors = { fields: {}, count: 0 }
  if (!draft.label.trim()) errors.label = 'テーブル名を入力してください'
  if (draft.mode === 'create') {
    if (!KEY_PATTERN.test(draft.key)) errors.key = '小文字の英字で始め、英数字と _ で書いてください'
    else if (meta.objects.some((o) => o.key === draft.key)) errors.key = 'この名前は既に使われています'
  }
  const rows = draft.fields.filter((f) => !isBlankRow(f))
  for (const f of rows) {
    let message: string | undefined
    if (!f.label.trim()) message = '項目名を入力してください'
    else if (!KEY_PATTERN.test(f.key)) message = '列名は、小文字の英字で始め、英数字と _ で書いてください'
    else if (RESERVED.has(f.key)) message = `列名 ${f.key} はシステムが使っています`
    else if (rows.some((o) => o !== f && o.key === f.key)) message = `列名 ${f.key} が重なっています`
    else if ((f.type === 'select' || f.type === 'multi_select') && !f.options.some((o) => o.label.trim())) message = '選択肢を 1 つ以上入れてください'
    else if (f.type === 'relation' && !f.target) message = '参照先のテーブルを選んでください'
    if (message) errors.fields[f.uid] = message
  }
  errors.count = Object.keys(errors.fields).length + (errors.label ? 1 : 0) + (errors.key ? 1 : 0)
  return errors
}
