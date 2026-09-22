import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import type { ObjectInput, SelectOption, TagColor } from '@/api/types'
import { createObject, deleteObject, getMeta, resetTables, updateObject } from './engine'

// テストケース表: docs/tests/meta.md。1 つの it が表の 1 行(ID をラベルに入れる)
const input = (key: string): ObjectInput => ({
  key,
  label: '試しのテーブル',
  icon: 'box',
  color: 'blue',
  fields: [{ key: 'name', label: '名前', type: 'text' }],
})

/** 呼んだ結果の ApiError の status(投げなければ null) */
function statusOf(fn: () => unknown): number | null {
  try {
    fn()
    return null
  } catch (e) {
    if (e instanceof ApiError) return e.status
    throw e
  }
}

describe('テーブル設定(mocks/engine.ts)', () => {
  beforeEach(() => resetTables())

  it('META-004 列名が規則外(大文字・先頭が数字・40 文字超)のテーブルは 400', () => {
    for (const key of ['Deals', 'deal_X', '1deals', '_deals', 'a'.repeat(41)]) {
      expect(statusOf(() => createObject(input(key))), key).toBe(400)
      expect(getMeta().objects.some((o) => o.key === key), key).toBe(false)
    }
    // 境界: 40 文字ちょうどは作れる
    const ok = 'a'.repeat(40)
    expect(statusOf(() => createObject(input(ok)))).toBeNull()
    expect(getMeta().objects.some((o) => o.key === ok)).toBe(true)
  })

  it('META-005 列名が予約語(users・meta・session・search)のテーブルは 400', () => {
    for (const key of ['users', 'meta', 'session', 'search']) {
      const before = getMeta().objects.length
      expect(statusOf(() => createObject(input(key))), key).toBe(400)
      expect(getMeta().objects.length, key).toBe(before)
    }
    // 予約語を含むだけの列名は作れる(完全一致だけを弾く)
    expect(statusOf(() => createObject(input('users_extra')))).toBeNull()
  })

  it('META-006 先頭の項目が文字(1 行)でないテーブルは 400。文字なら name_field になり必須が付く', () => {
    for (const type of ['textarea', 'richtext', 'number', 'email', 'date'] as const) {
      const key = `first_${type}`
      const body = { ...input(key), fields: [{ key: 'body', label: '本文', type }, { key: 'name', label: '名前', type: 'text' as const }] }
      expect(statusOf(() => createObject(body)), type).toBe(400)
      expect(getMeta().objects.some((o) => o.key === key), type).toBe(false)
    }
    // 文字なら作れて、先頭の項目が表示名になり、required を付けずに送っても必須になる
    const body = { ...input('first_text'), fields: [{ key: 'title', label: '件名', type: 'text' as const }, { key: 'memo', label: 'メモ', type: 'textarea' as const }] }
    expect(statusOf(() => createObject(body))).toBeNull()
    const made = getMeta().objects.find((o) => o.key === 'first_text')
    expect(made?.name_field).toBe('title')
    expect(made?.fields.find((f) => f.key === 'title')?.required).toBe(true)
    expect(made?.fields.find((f) => f.key === 'memo')?.required).toBeFalsy()
  })

  it('META-007 項目の列名が id・created_at・updated_at なら 400。同じ列名が 2 つでも 400', () => {
    for (const key of ['id', 'created_at', 'updated_at']) {
      const table = `sys_${key}`
      const body = { ...input(table), fields: [{ key: 'name', label: '名前', type: 'text' as const }, { key, label: '予約', type: 'text' as const }] }
      expect(statusOf(() => createObject(body)), key).toBe(400)
      expect(getMeta().objects.some((o) => o.key === table), key).toBe(false)
    }
    // 同じ列名が 2 つ(型が違っても)
    const dup = { ...input('dup_fields'), fields: [{ key: 'name', label: '名前', type: 'text' as const }, { key: 'memo', label: 'メモ', type: 'text' as const }, { key: 'memo', label: 'メモ 2', type: 'textarea' as const }] }
    expect(statusOf(() => createObject(dup))).toBe(400)
    expect(getMeta().objects.some((o) => o.key === 'dup_fields')).toBe(false)
    // 予約語を含むだけの列名や、別々の列名なら作れる
    const ok = { ...input('ok_fields'), fields: [{ key: 'name', label: '名前', type: 'text' as const }, { key: 'external_id', label: '外部 ID', type: 'text' as const }, { key: 'created_at_origin', label: '元の作成日', type: 'date' as const }] }
    expect(statusOf(() => createObject(ok))).toBeNull()
    expect(getMeta().objects.some((o) => o.key === 'ok_fields')).toBe(true)
  })

  it('META-008 作ったテーブルに created_at・updated_at(readonly)が付き、position は末尾、in_sidebar は既定 true', () => {
    const before = Math.max(...getMeta().objects.map((o) => o.position))
    const body = { ...input('stamped'), fields: [{ key: 'name', label: '名前', type: 'text' as const }, { key: 'memo', label: 'メモ', type: 'textarea' as const }] }
    expect(statusOf(() => createObject(body))).toBeNull()
    const made = getMeta().objects.find((o) => o.key === 'stamped')
    // 入れた項目の後ろに、システムの列が readonly で付く
    expect(made?.fields.map((f) => f.key)).toEqual(['name', 'memo', 'created_at', 'updated_at'])
    for (const key of ['created_at', 'updated_at']) {
      const f = made?.fields.find((x) => x.key === key)
      expect(f?.type, key).toBe('datetime')
      expect(f?.readonly, key).toBe(true)
    }
    expect(made?.fields.find((f) => f.key === 'memo')?.readonly).toBeFalsy()
    // サイドバーの末尾に並び、既定で出る
    expect(made?.position).toBeGreaterThan(before)
    expect(made?.in_sidebar).toBe(true)
    // 続けて作ると、さらに後ろ。in_sidebar: false を渡せば出さない
    expect(statusOf(() => createObject({ ...input('hidden_one'), in_sidebar: false }))).toBeNull()
    const next = getMeta().objects.find((o) => o.key === 'hidden_one')
    expect(next?.position).toBeGreaterThan(made!.position)
    expect(next?.in_sidebar).toBe(false)
    expect(next?.fields.filter((f) => f.readonly).map((f) => f.key)).toEqual(['created_at', 'updated_at'])
  })

  it('META-009 選択肢の項目は options 無し・値が重なる options・9 色の外の色なら 400', () => {
    const body = (table: string, type: 'select' | 'multi_select', options?: SelectOption[]): ObjectInput => ({
      ...input(table),
      fields: [{ key: 'name', label: '名前', type: 'text' }, { key: 'stage', label: '段階', type, ...(options ? { options } : {}) }],
    })
    const bad: [string, SelectOption[] | undefined][] = [
      ['none', undefined],
      ['empty', []],
      // 名前が空白だけの選択肢は捨てられるので、無いのと同じ
      ['blank', [{ value: 'a', label: '  ', color: 'gray' }]],
      ['dup', [{ value: 'a', label: '甲', color: 'gray' }, { value: 'a', label: '乙', color: 'blue' }]],
      ['color', [{ value: 'a', label: '甲', color: 'purple' as TagColor }]],
    ]
    for (const type of ['select', 'multi_select'] as const) {
      for (const [name, options] of bad) {
        const table = `opt_${type}_${name}`
        expect(statusOf(() => createObject(body(table, type, options))), table).toBe(400)
        expect(getMeta().objects.some((o) => o.key === table), table).toBe(false)
      }
      // 9 色のどれでも、値が別々なら作れる
      const colors: TagColor[] = ['gray', 'green', 'teal', 'blue', 'violet', 'pink', 'red', 'orange', 'amber']
      const table = `opt_${type}_ok`
      expect(statusOf(() => createObject(body(table, type, colors.map((color, i) => ({ value: `v${i}`, label: `選択肢 ${i}`, color })))))).toBeNull()
      expect(getMeta().objects.find((o) => o.key === table)?.fields.find((f) => f.key === 'stage')?.options?.map((o) => o.color)).toEqual(colors)
    }
  })

  it('META-010 参照の項目に参照先が無い、または削除中のテーブルなら 400', () => {
    const body = (table: string, target?: string): ObjectInput => ({
      ...input(table),
      fields: [{ key: 'name', label: '名前', type: 'text' }, { key: 'ref', label: '参照', type: 'relation', ...(target !== undefined ? { target } : {}) }],
    })
    // 削除中のテーブルを用意する(初めから入っているテーブルは削除できないので、作ってから消す)
    expect(statusOf(() => createObject(input('gone')))).toBeNull()
    deleteObject('gone')
    for (const [name, target] of [['none', undefined], ['empty', ''], ['missing', 'no_such_table'], ['trashed', 'gone']] as const) {
      const table = `rel_${name}`
      expect(statusOf(() => createObject(body(table, target))), table).toBe(400)
      expect(getMeta().objects.some((o) => o.key === table), table).toBe(false)
    }
    // 生きているテーブルを指せば作れて、参照先が残る
    expect(statusOf(() => createObject(body('rel_ok', 'accounts')))).toBeNull()
    expect(getMeta().objects.find((o) => o.key === 'rel_ok')?.fields.find((f) => f.key === 'ref')?.target).toBe('accounts')
  })

  it('META-011 文字の項目の max_length が 0・100001、数値の scale が 7 なら 400。scale 1〜6 は保存される', () => {
    const withField = (table: string, field: ObjectInput['fields'][number]): ObjectInput => ({
      ...input(table),
      fields: [{ key: 'name', label: '名前', type: 'text' }, field],
    })
    const savedField = (table: string) => getMeta().objects.find((o) => o.key === table)?.fields.find((f) => f.key === 'extra')
    for (const [name, maxLength] of [['zero', 0], ['over', 100001]] as const) {
      const table = `len_${name}`
      expect(statusOf(() => createObject(withField(table, { key: 'extra', label: 'メモ', type: 'text', max_length: maxLength }))), table).toBe(400)
      expect(getMeta().objects.some((o) => o.key === table), table).toBe(false)
    }
    // 境界: 1 と 100000 は保存される
    for (const [name, maxLength] of [['min', 1], ['max', 100000]] as const) {
      const table = `len_${name}`
      expect(statusOf(() => createObject(withField(table, { key: 'extra', label: 'メモ', type: 'text', max_length: maxLength }))), table).toBeNull()
      expect(savedField(table)?.max_length, table).toBe(maxLength)
    }
    expect(statusOf(() => createObject(withField('scale_7', { key: 'extra', label: '金額', type: 'number', scale: 7 })))).toBe(400)
    expect(getMeta().objects.some((o) => o.key === 'scale_7')).toBe(false)
    for (const scale of [1, 2, 3, 4, 5, 6]) {
      const table = `scale_${scale}`
      expect(statusOf(() => createObject(withField(table, { key: 'extra', label: '金額', type: 'number', scale }))), table).toBeNull()
      expect(savedField(table)?.scale, table).toBe(scale)
    }
  })

  it('META-012 updateObject で既存の項目の型を変えると 400 になり、型は元のまま', () => {
    const fields: ObjectInput['fields'] = [
      { key: 'name', label: '名前', type: 'text' },
      { key: 'amount', label: '金額', type: 'number' },
    ]
    expect(statusOf(() => createObject({ ...input('type_fixed'), fields }))).toBeNull()
    const typeOf = () => getMeta().objects.find((o) => o.key === 'type_fixed')?.fields.find((f) => f.key === 'amount')?.type
    for (const type of ['text', 'textarea', 'percent', 'date', 'email'] as const) {
      const body = { ...input('type_fixed'), label: '変えた名前', fields: [fields[0], { key: 'amount', label: '金額', type }] }
      expect(statusOf(() => updateObject('type_fixed', body)), type).toBe(400)
      expect(typeOf(), type).toBe('number')
      // 弾いた更新は、他の変更(テーブル名)も残さない
      expect(getMeta().objects.find((o) => o.key === 'type_fixed')?.label, type).toBe('試しのテーブル')
    }
    // 型を変えなければ同じ本文で更新できる
    expect(statusOf(() => updateObject('type_fixed', { ...input('type_fixed'), label: '変えた名前', fields }))).toBeNull()
    expect(getMeta().objects.find((o) => o.key === 'type_fixed')?.label).toBe('変えた名前')
    expect(typeOf()).toBe('number')
  })

  it('META-013 updateObject で既存の参照項目の参照先を変える本文を送っても、参照先は元のまま保たれる', () => {
    const fields = (target: string): ObjectInput['fields'] => [
      { key: 'name', label: '名前', type: 'text' },
      { key: 'ref', label: '参照', type: 'relation', target },
    ]
    expect(statusOf(() => createObject({ ...input('ref_fixed'), fields: fields('accounts') }))).toBeNull()
    const targetOf = () => getMeta().objects.find((o) => o.key === 'ref_fixed')?.fields.find((f) => f.key === 'ref')?.target
    expect(targetOf()).toBe('accounts')
    // 生きている別のテーブル・無いテーブル・空を指しても、参照先は変わらない(他の変更は通る)
    for (const target of ['contacts', 'no_such_table', '']) {
      const label = `変えた名前_${target}`
      updateObject('ref_fixed', { ...input('ref_fixed'), label, fields: fields(target) })
      expect(targetOf(), target).toBe('accounts')
      expect(getMeta().objects.find((o) => o.key === 'ref_fixed')?.label, target).toBe(label)
    }
  })

  it('META-014 updateObject で表示名の項目や locked の項目(商談のフェーズ)を本文から外すと 400 になり、定義は元のまま', () => {
    const deals = () => getMeta().objects.find((o) => o.key === 'opportunities')!
    const before = deals()
    expect(before.name_field).toBe('name')
    expect(before.fields.find((f) => f.key === 'stage')?.locked).toBe(true)
    const keys = () => deals().fields.map((f) => f.key)
    const beforeKeys = keys()
    // 画面が送るのと同じ全量の本文(システムが埋める列は含めない)から、1 つだけ外す
    const bodyWithout = (omit: string): ObjectInput => ({
      key: 'opportunities',
      label: '変えた名前',
      icon: before.icon,
      color: before.color,
      fields: before.fields
        .filter((f) => !f.readonly && f.key !== omit)
        .map(({ key, label, type, required, options, target, max_length, scale, placeholder }) => ({ key, label, type, required, options, target, max_length, scale, placeholder })),
    })
    for (const omit of ['name', 'stage']) {
      expect(statusOf(() => updateObject('opportunities', bodyWithout(omit))), omit).toBe(400)
      // 弾いた更新は、項目も他の変更(テーブル名)も残さない
      expect(keys(), omit).toEqual(beforeKeys)
      expect(deals().label, omit).toBe('商談')
    }
    // 守られていない項目(金額)なら同じ形の本文で外せる
    expect(statusOf(() => updateObject('opportunities', bodyWithout('amount')))).toBeNull()
    expect(keys()).not.toContain('amount')
    expect(deals().label).toBe('変えた名前')
  })
})
