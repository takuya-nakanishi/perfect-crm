import type { FieldMeta, ObjectMeta, References, RefRecord, Row, Scalar, SelectOption } from '@/api/types'

export function fieldOf(meta: ObjectMeta, key: string): FieldMeta | undefined {
  return meta.fields.find((f) => f.key === key)
}

export function recordName(meta: ObjectMeta, row: Row): string {
  const v = row[meta.name_field]
  return typeof v === 'string' && v ? v : '名称未設定'
}

export function optionOf(field: FieldMeta, value: Scalar | undefined): SelectOption | undefined {
  return field.options?.find((o) => o.value === value)
}

/** 参照型の列が指しているレコード(テーブル名と表示用の情報)。指していなければ null */
export function refFor(field: FieldMeta, row: Row, references: References): { object: string; ref: RefRecord } | null {
  let object: string | undefined
  let id: Scalar | undefined
  if (field.type === 'relation') {
    object = field.target
    id = row[field.key]
  } else if (field.type === 'user') {
    object = 'users'
    id = row[field.key]
  } else if (field.type === 'polymorphic' && field.columns) {
    const o = row[field.columns.object]
    object = typeof o === 'string' ? o : undefined
    id = row[field.columns.id]
  }
  if (!object || typeof id !== 'string') return null
  // 参照先の表示名がまだ届いていないときも、リンクとしては成立させる
  return { object, ref: references[object]?.[id] ?? { id, name: '…' } }
}

/** そのレコードが「終わったもの」か(完了したタスク、受注・失注した商談)。期限切れの色を出すかどうかに使う */
export function isClosed(meta: ObjectMeta, row: Row): boolean {
  return meta.fields.some((f) => {
    if (f.type !== 'select') return false
    const kind = optionOf(f, row[f.key])?.kind
    return kind === 'won' || kind === 'lost' || kind === 'done'
  })
}

/** 列の値が空か(polymorphic は ID 列で見る) */
export function isEmptyValue(field: FieldMeta, row: Row): boolean {
  const v = field.type === 'polymorphic' && field.columns ? row[field.columns.id] : row[field.key]
  return v === null || v === undefined || v === ''
}
