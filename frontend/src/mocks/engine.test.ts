import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import type { ObjectInput, Scalar, SelectOption, TagColor, ViewInput } from '@/api/types'
import { aggregate, createObject, createView, deleteObject, deleteView, find, getMeta, insert, query, refOf, reorderObjects, reorderViews, resetTables, restoreObject, restoreView, searchAll, table, update, updateObject, updateView } from './engine'

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

  it('META-015 updateObject で完了の仕組みが使う列(タスクの状況)や活動の件名・種別・日付・内容を本文から外すと 400、完了日時は外れない', () => {
    const find = (key: string) => getMeta().objects.find((o) => o.key === key)!
    const keys = (key: string) => find(key).fields.map((f) => f.key)
    // 画面が送るのと同じ全量の本文(システムが埋める列は含めない)から、1 つだけ外す
    const bodyWithout = (key: string, omit: string): ObjectInput => {
      const before = find(key)
      return {
        key,
        label: '変えた名前',
        icon: before.icon,
        color: before.color,
        fields: before.fields
          .filter((f) => !f.readonly && f.key !== omit)
          .map(({ key, label, type, required, options, target, max_length, scale, placeholder }) => ({ key, label, type, required, options, target, max_length, scale, placeholder })),
      }
    }
    const tasks = find('tasks')
    expect(tasks.completion?.field).toBe('status')
    expect(tasks.completion?.completed_at_field).toBe('completed_at')
    expect(find('activities').timeline).toEqual({ subject: 'subject', type: 'type', date: 'occurred_on', body: 'body' })
    const cases: [string, string, string][] = [
      ['tasks', 'status', 'タスク'],
      ['activities', 'subject', '活動'],
      ['activities', 'type', '活動'],
      ['activities', 'occurred_on', '活動'],
      ['activities', 'body', '活動'],
    ]
    for (const [key, omit, label] of cases) {
      const beforeKeys = keys(key)
      expect(beforeKeys, omit).toContain(omit)
      expect(statusOf(() => updateObject(key, bodyWithout(key, omit))), omit).toBe(400)
      // 弾いた更新は、項目も他の変更(テーブル名)も残さない
      expect(keys(key), omit).toEqual(beforeKeys)
      expect(find(key).label, omit).toBe(label)
    }
    // 完了日時はシステムが埋める列で本文に入らない。無い本文を送っても外れない
    expect(statusOf(() => updateObject('tasks', bodyWithout('tasks', 'completed_at')))).toBeNull()
    expect(keys('tasks')).toContain('completed_at')
    // 守られていない項目(タスクの詳細)なら同じ形の本文で外せる
    expect(statusOf(() => updateObject('tasks', bodyWithout('tasks', 'description')))).toBeNull()
    expect(keys('tasks')).not.toContain('description')
    expect(keys('tasks')).toContain('completed_at')
  })

  it('META-016 updateObject でタスクの状況の選択肢から done や open を消すと 400 で弾き、選択肢が元のまま残る', () => {
    const tasks = () => getMeta().objects.find((o) => o.key === 'tasks')!
    const values = () => tasks().fields.find((f) => f.key === 'status')!.options!.map((o) => o.value)
    // 画面が送るのと同じ全量の本文で、状況の選択肢から 1 つだけ消す
    const bodyWithout = (value: string): ObjectInput => {
      const before = tasks()
      return {
        key: 'tasks',
        label: '変えた名前',
        icon: before.icon,
        color: before.color,
        fields: before.fields
          .filter((f) => !f.readonly)
          .map(({ key, label, type, required, options, target, max_length, scale, placeholder }) => ({
            key,
            label,
            type,
            required,
            options: key === 'status' ? options?.filter((o) => o.value !== value) : options,
            target,
            max_length,
            scale,
            placeholder,
          })),
      }
    }
    expect(tasks().completion).toMatchObject({ field: 'status', done_value: 'done', open_value: 'open' })
    const before = values()
    expect(before).toEqual(expect.arrayContaining(['done', 'open']))
    for (const value of ['done', 'open']) {
      expect(statusOf(() => updateObject('tasks', bodyWithout(value))), value).toBe(400)
      // 弾いた更新は、選択肢も他の変更(テーブル名)も残さない
      expect(values(), value).toEqual(before)
      expect(tasks().label, value).toBe('タスク')
    }
    // 完了の仕組みが使わない選択肢なら消せる
    const other = before.find((v) => v !== 'done' && v !== 'open')
    expect(other).toBeDefined()
    expect(statusOf(() => updateObject('tasks', bodyWithout(other!)))).toBeNull()
    expect(values()).toEqual(before.filter((v) => v !== other))
  })

  it('META-017 項目を足して保存すると、先頭の一覧ビューの列に updated_at の手前で加わる', () => {
    const accounts = () => getMeta().objects.find((o) => o.key === 'accounts')!
    const lists = () => getMeta().views.filter((v) => v.object === 'accounts' && v.type === 'list').sort((a, b) => a.position - b.position)
    const columns = () => {
      const list = lists()[0]
      return list.type === 'list' ? list.config.columns.map((c) => c.field) : []
    }
    const before = columns()
    expect(before.at(-1)).toBe('updated_at')
    // 画面が送るのと同じ全量の本文に、項目を 1 つ足す
    const current = accounts()
    const body: ObjectInput = {
      key: 'accounts',
      label: current.label,
      icon: current.icon,
      color: current.color,
      fields: [
        ...current.fields
          .filter((f) => !f.readonly)
          .map(({ key, label, type, required, options, target, max_length, scale, placeholder }) => ({ key, label, type, required, options, target, max_length, scale, placeholder })),
        { key: 'fiscal_month', label: '決算月', type: 'text' },
      ],
    }
    expect(statusOf(() => updateObject('accounts', body))).toBeNull()
    expect(accounts().fields.some((f) => f.key === 'fiscal_month')).toBe(true)
    // 既存の列の並びはそのまま、足した列が updated_at の手前に 1 つだけ入る
    expect(columns()).toEqual([...before.slice(0, -1), 'fiscal_month', 'updated_at'])
  })
  it('META-020 選択肢の項目を初めて足したテーブルを保存すると、その項目で分けるカンバンが 1 枚でき、既にあれば増えない', () => {
    const kanbans = () => getMeta().views.filter((v) => v.object === 'trial' && v.type === 'kanban')
    const options: SelectOption[] = [
      { value: 'a', label: 'A', color: 'blue' },
      { value: 'b', label: 'B', color: 'green' },
    ]
    const name = { key: 'name', label: '名前', type: 'text' } as const
    const stage = { key: 'stage', label: '段階', type: 'select', options } as const
    const rank = { key: 'rank', label: '等級', type: 'select', options } as const
    // 選択肢の項目が無いテーブルには、カンバンが無い
    expect(statusOf(() => createObject({ ...input('trial'), fields: [name] }))).toBeNull()
    expect(kanbans()).toHaveLength(0)
    // 選択肢の項目を初めて足して保存 → その項目で分けるカンバンが 1 枚
    expect(statusOf(() => updateObject('trial', { ...input('trial'), fields: [name, stage] }))).toBeNull()
    expect(kanbans()).toHaveLength(1)
    const [kanban] = kanbans()
    expect(kanban.type === 'kanban' && kanban.config.group_by).toBe('stage')
    // もう 1 つ選択肢の項目を足しても、カンバンは増えず、分け方も変わらない
    expect(statusOf(() => updateObject('trial', { ...input('trial'), fields: [name, stage, rank] }))).toBeNull()
    expect(kanbans()).toHaveLength(1)
    const [after] = kanbans()
    expect(after.id).toBe(kanban.id)
    expect(after.type === 'kanban' && after.config.group_by).toBe('stage')
  })

  it('META-021 label を変えて保存しても、本文に無い semantic・in_create_form・選択肢の kind と probability は保たれる', () => {
    const deals = () => getMeta().objects.find((o) => o.key === 'opportunities')!
    const fieldOf = (key: string) => deals().fields.find((f) => f.key === key)!
    const before = deals()
    const stageBefore = fieldOf('stage').options!
    expect(fieldOf('close_date').semantic).toBe('deadline')
    expect(fieldOf('type').in_create_form).toBe(false)
    expect(fieldOf('probability').in_create_form).toBe(false)
    expect(stageBefore.map((o) => o.kind)).toEqual(['open', 'open', 'open', 'open', 'open', 'won', 'lost'])
    // 本文に書ける属性だけで全量を送る(MCP・AI チャットの形)。選択肢は value・label・color だけ。label だけを変える
    const body: ObjectInput = {
      key: 'opportunities',
      label: '案件',
      icon: before.icon,
      color: before.color,
      fields: before.fields
        .filter((f) => !f.readonly)
        .map(({ key, label, type, required, options, target, max_length, scale, placeholder }) => ({
          key,
          label: key === 'stage' ? '段階' : label,
          type,
          required,
          options: options?.map(({ value, label, color }) => ({ value, label: value === 'won' ? '成約' : label, color })),
          target,
          max_length,
          scale,
          placeholder,
        })),
    }
    expect(body.fields.flatMap((f) => f.options ?? []).some((o) => 'kind' in o || 'probability' in o)).toBe(false)
    expect(statusOf(() => updateObject('opportunities', body))).toBeNull()
    // label は変わる
    expect(deals().label).toBe('案件')
    expect(fieldOf('stage').label).toBe('段階')
    expect(fieldOf('stage').options!.find((o) => o.value === 'won')?.label).toBe('成約')
    // 本文に無い属性は元のまま
    expect(fieldOf('close_date').semantic).toBe('deadline')
    expect(fieldOf('type').in_create_form).toBe(false)
    expect(fieldOf('probability').in_create_form).toBe(false)
    expect(fieldOf('stage').options!.map(({ value, kind, probability }) => ({ value, kind, probability }))).toEqual(
      stageBefore.map(({ value, kind, probability }) => ({ value, kind, probability })),
    )
  })

  it('META-022 in_sidebar: false で保存すると GET /meta の in_sidebar が false になり、本文に無ければ変わらない', () => {
    const sidebar = () => getMeta().objects.find((o) => o.key === 'trial')!.in_sidebar
    // 作るときに送らなければ、サイドバーに出る
    expect(statusOf(() => createObject(input('trial')))).toBeNull()
    expect(sidebar()).toBe(true)
    // false で保存 → false
    expect(statusOf(() => updateObject('trial', { ...input('trial'), in_sidebar: false }))).toBeNull()
    expect(sidebar()).toBe(false)
    // 本文に無ければ false のまま(既定の true に戻さない)
    expect(statusOf(() => updateObject('trial', { ...input('trial'), label: '名前を変えた' }))).toBeNull()
    expect(sidebar()).toBe(false)
    // true で保存 → true。本文に無ければ true のまま
    expect(statusOf(() => updateObject('trial', { ...input('trial'), in_sidebar: true }))).toBeNull()
    expect(sidebar()).toBe(true)
    expect(statusOf(() => updateObject('trial', input('trial')))).toBeNull()
    expect(sidebar()).toBe(true)
  })

  it('META-023 新しいテーブルを作ると、活動の関連先(all_targets)の targets にそのテーブルが加わる', () => {
    const targets = (object: string) => getMeta().objects.find((o) => o.key === object)!.fields.find((f) => f.key === 'related')!.targets
    const before = [...targets('activities')!]
    expect(before).not.toContain('trial')
    expect(statusOf(() => createObject(input('trial')))).toBeNull()
    // 活動の関連先: 元の関連先を保ったまま、末尾に 1 回だけ加わる
    expect(targets('activities')).toEqual([...before, 'trial'])
    // all_targets の無い関連先(タスク)には加わらない
    expect(targets('tasks')).toEqual(['accounts', 'opportunities'])
  })

  it('META-024 reorderObjects にサイドバーの 3 件だけ渡すと、その順が先頭で、出していないテーブルは元の順で後ろ。無いテーブルを含めれば 400', () => {
    // サイドバーに出していないテーブルを 2 つ足す(並びの末尾に付く)
    expect(statusOf(() => createObject({ ...input('hidden_a'), in_sidebar: false }))).toBeNull()
    expect(statusOf(() => createObject({ ...input('hidden_b'), in_sidebar: false }))).toBeNull()
    const ordered = () => [...getMeta().objects].sort((a, b) => a.position - b.position)
    const before = ordered().map((o) => o.key)
    const sidebar = ordered().filter((o) => o.in_sidebar).map((o) => o.key)
    expect(sidebar.length).toBeGreaterThanOrEqual(3)
    // サイドバーの 3 件を逆順にして渡す
    const picked = sidebar.slice(0, 3).reverse()
    expect(statusOf(() => reorderObjects(picked))).toBeNull()
    const after = ordered()
    expect(after.map((o) => o.key)).toEqual([...picked, ...before.filter((k) => !picked.includes(k))])
    // position は 1 から詰めて振り直す
    expect(after.map((o) => o.position)).toEqual(after.map((_, i) => i + 1))
    // 無いテーブル・削除したテーブルを含めれば 400 で、並びは変わらない
    const current = after.map((o) => o.key)
    expect(statusOf(() => reorderObjects([sidebar[0], 'no_such_table']))).toBe(400)
    expect(statusOf(() => deleteObject('hidden_b'))).toBeNull()
    expect(statusOf(() => reorderObjects(['hidden_b', sidebar[1]]))).toBe(400)
    expect(ordered().map((o) => o.key)).toEqual(current.filter((k) => k !== 'hidden_b'))
  })

  it('META-048 createView の名前が空(空白だけも)なら 400。無い項目を列・並び・条件(入れ子も)に指しても 400 で、ビューは増えない', () => {
    const accounts = getMeta().objects.find((o) => o.key === 'accounts')!
    const name = accounts.name_field
    const other = accounts.fields.find((f) => f.key !== name)!.key
    const view = (patch: Partial<Extract<ViewInput, { type: 'list' }>['config']> = {}, label = '試しのビュー'): ViewInput => ({
      name: label,
      type: 'list',
      config: {
        columns: [{ field: name }, { field: other }],
        filter: { and: [{ field: other, op: 'is_not_empty' }, { or: [{ field: name, op: 'contains', value: '株式' }] }] },
        sort: [{ field: name, dir: 'asc' }],
        ...patch,
      },
    })
    const count = () => getMeta().views.filter((v) => v.object === 'accounts').length
    const before = count()
    // 名前が空・空白だけ
    expect(statusOf(() => createView('accounts', view({}, '')))).toBe(400)
    expect(statusOf(() => createView('accounts', view({}, '   ')))).toBe(400)
    // 無い項目を列・並び・条件に指す(条件は入れ子の奥でも)
    expect(statusOf(() => createView('accounts', view({ columns: [{ field: name }, { field: 'no_such_field' }] })))).toBe(400)
    expect(statusOf(() => createView('accounts', view({ sort: [{ field: 'no_such_field', dir: 'desc' }] })))).toBe(400)
    expect(statusOf(() => createView('accounts', view({ filter: { field: 'no_such_field', op: 'is_empty' } })))).toBe(400)
    expect(
      statusOf(() => createView('accounts', view({ filter: { and: [{ field: other, op: 'is_not_empty' }, { or: [{ field: 'no_such_field', op: 'eq', value: 1 }] }] } }))),
    ).toBe(400)
    // 弾いたものは 1 枚も作られない
    expect(count()).toBe(before)
    // 同じ本文で名前と項目が揃っていれば作れる(名前は前後の空白を落として保存)
    expect(statusOf(() => createView('accounts', view({}, '  試しのビュー  ')))).toBeNull()
    expect(count()).toBe(before + 1)
    expect(getMeta().views.filter((v) => v.object === 'accounts').map((v) => v.name)).toContain('試しのビュー')
  })

  it('META-049 カンバンの group_by に選択肢でない項目(文字・参照・金額・日付・担当者など)や無い項目を指すと 400 で、ビューは増えない', () => {
    const opps = getMeta().objects.find((o) => o.key === 'opportunities')!
    const select = opps.fields.find((f) => f.type === 'select')!
    const others = opps.fields.filter((f) => f.type !== 'select')
    // 前提: 選択肢でない型が何種類もある(文字・参照・金額・日付など)
    expect(new Set(others.map((f) => f.type)).size).toBeGreaterThan(1)
    const kanban = (group_by: string): ViewInput => ({
      name: '試しのカンバン',
      type: 'kanban',
      config: { group_by, card_fields: [opps.name_field] },
    })
    const count = () => getMeta().views.filter((v) => v.object === 'opportunities').length
    const before = count()
    for (const f of others) expect(statusOf(() => createView('opportunities', kanban(f.key))), `${f.key}(${f.type})`).toBe(400)
    expect(statusOf(() => createView('opportunities', kanban('no_such_field')))).toBe(400)
    // 既にあるビューをカンバンに変えるときも同じ
    const list = getMeta().views.find((v) => v.object === 'opportunities' && v.type === 'list')!
    for (const f of others) expect(statusOf(() => updateView(list.id, kanban(f.key))), `${f.key}(${f.type})`).toBe(400)
    expect(getMeta().views.find((v) => v.id === list.id)!.type).toBe('list')
    expect(count()).toBe(before)
    // 選択肢の項目なら作れる
    expect(statusOf(() => createView('opportunities', kanban(select.key)))).toBeNull()
    expect(count()).toBe(before + 1)
  })

  it('META-050 createView の position は同じテーブルの末尾(他のテーブルの並びは見ない)。pin を付けると pin.position はお気に入り(全テーブル)の末尾', () => {
    const accounts = getMeta().objects.find((o) => o.key === 'accounts')!
    const opps = getMeta().objects.find((o) => o.key === 'opportunities')!
    const view = (name: string, pin?: ViewInput['pin'], object = accounts): ViewInput => ({
      name,
      type: 'list',
      config: { columns: [{ field: object.name_field }] },
      ...(pin ? { pin } : {}),
    })
    const created = (before: string[]) => getMeta().views.find((v) => !before.includes(v.id))!
    const ids = () => getMeta().views.map((v) => v.id)
    const lastOf = (object: string) => Math.max(0, ...getMeta().views.filter((v) => v.object === object).map((v) => v.position))
    const lastPin = () => Math.max(0, ...getMeta().views.map((v) => v.pin?.position ?? 0))
    let before = ids()
    const accountsLast = lastOf('accounts')
    createView('accounts', view('試し 1'))
    const a = created(before)
    expect(a.position).toBe(accountsLast + 1)
    expect(a.pin).toBeUndefined()
    // 続けて作ると、そのさらに後ろ
    before = ids()
    createView('accounts', view('試し 2'))
    expect(created(before).position).toBe(accountsLast + 2)
    // 別のテーブルは、そのテーブルの末尾から数える
    before = ids()
    const oppsLast = lastOf('opportunities')
    createView('opportunities', view('試しの商談', undefined, opps))
    expect(created(before).position).toBe(oppsLast + 1)
    expect(lastOf('accounts')).toBe(accountsLast + 2)
    // pin を付けて作ると、渡した position は使わず、お気に入り全体の末尾に付く
    const pinLast = lastPin()
    before = ids()
    createView('accounts', view('試し 3', { label: 'お気に入り 1', position: 1, show_count: true }))
    const p1 = created(before)
    expect(p1.pin).toEqual({ label: 'お気に入り 1', position: pinLast + 1, show_count: true })
    expect(p1.position).toBe(accountsLast + 3)
    // 別のテーブルで pin を付けても、お気に入りはテーブルをまたいで 1 列の末尾
    before = ids()
    createView('opportunities', view('試しの商談 2', { label: 'お気に入り 2', position: 0 }, opps))
    expect(created(before).pin!.position).toBe(pinLast + 2)
  })

  it('META-051 pin を付けたまま updateView(名前だけ変える)→ pin.position は変わらない。外して保存し、また付けて保存するとお気に入りの末尾(元の位置には戻らない)', () => {
    const accounts = getMeta().objects.find((o) => o.key === 'accounts')!
    const ids = () => getMeta().views.map((v) => v.id)
    const lastPin = () => Math.max(0, ...getMeta().views.map((v) => v.pin?.position ?? 0))
    const viewOf = (id: string) => getMeta().views.find((v) => v.id === id)!
    /** 画面が保存するときの本文(name・type・config・pin の全量) */
    const inputOf = (id: string): ViewInput => {
      const { id: _id, object: _object, position: _position, ...rest } = viewOf(id)
      return rest as ViewInput
    }
    const make = (name: string) => {
      const before = ids()
      createView('accounts', { name, type: 'list', config: { columns: [{ field: accounts.name_field }] }, pin: { label: name, position: 0 } })
      return getMeta().views.find((v) => !before.includes(v.id))!.id
    }
    const a = make('試し A')
    const b = make('試し B')
    const aPin = viewOf(a).pin!.position
    expect(viewOf(b).pin!.position).toBe(aPin + 1)
    // 名前だけ変えて保存しても、お気に入りの位置はそのまま
    updateView(a, { ...inputOf(a), name: '試し A2' })
    expect(viewOf(a).name).toBe('試し A2')
    expect(viewOf(a).pin).toEqual({ label: '試し A', position: aPin })
    // 本文の pin.position が違っても、既にあるお気に入りの位置は動かない
    updateView(a, { ...inputOf(a), pin: { label: '試し A', position: 999 } })
    expect(viewOf(a).pin!.position).toBe(aPin)
    // 外して保存
    const { pin: _pin, ...unpinned } = inputOf(a)
    updateView(a, unpinned as ViewInput)
    expect(viewOf(a).pin).toBeUndefined()
    // もう一度付けて保存すると、元の位置(aPin)ではなく末尾
    const last = lastPin()
    expect(last).toBeGreaterThanOrEqual(aPin + 1)
    updateView(a, { ...inputOf(a), pin: { label: '試し A', position: aPin } })
    expect(viewOf(a).pin!.position).toBe(last + 1)
    expect(viewOf(b).pin!.position).toBe(aPin + 1)
  })

  it('META-052 そのテーブルの最後の 1 枚を deleteView → 400。ごみ箱にあるビューは数えず、他のテーブルのビューがあっても消せない', () => {
    const viewsOf = (object: string) => getMeta().views.filter((v) => v.object === object).map((v) => v.id)
    const mine = viewsOf('accounts')
    const others = getMeta().views.filter((v) => v.object !== 'accounts').length
    expect(mine.length).toBeGreaterThanOrEqual(2)
    expect(others).toBeGreaterThan(0)
    // 最後の 1 枚まではふつうに消せる(消したものはごみ箱へ)
    for (const id of mine.slice(1)) expect(statusOf(() => deleteView(id))).toBeNull()
    expect(viewsOf('accounts')).toEqual([mine[0]])
    // 残った 1 枚は消せず、そのまま残る
    expect(statusOf(() => deleteView(mine[0]))).toBe(400)
    expect(viewsOf('accounts')).toEqual([mine[0]])
    expect(getMeta().views.filter((v) => v.object !== 'accounts').length).toBe(others)
  })

  it('META-053 deleteView → GET /meta から消える。restoreView → 同じ id・同じ定義(並び・お気に入りも)で戻る', () => {
    const before = getMeta().views
    // 定義の多いビュー(お気に入りに入っているものがあればそれ)で確かめる
    const target = before.find((v) => v.pin) ?? before[0]
    const deleted = deleteView(target.id)
    expect(deleted.views.some((v) => v.id === target.id)).toBe(false)
    expect(getMeta().views.some((v) => v.id === target.id)).toBe(false)
    expect(getMeta().views).toEqual(before.filter((v) => v.id !== target.id))
    const restored = restoreView(target.id)
    expect(restored.views.find((v) => v.id === target.id)).toEqual(target)
    expect(getMeta().views).toEqual(before)
  })

  it('META-054 reorderViews に全 id を渡す → その順に position(1 から)。足りない・他テーブルの id を混ぜる → 400 で並びは変わらない', () => {
    const viewsOf = (object: string) =>
      getMeta()
        .views.filter((v) => v.object === object)
        .map((v) => ({ id: v.id, position: v.position }))
    const mine = viewsOf('accounts').map((v) => v.id)
    const other = getMeta().views.find((v) => v.object !== 'accounts')!.id
    expect(mine.length).toBeGreaterThanOrEqual(2)
    // 逆順に並べ替える → 渡した順に 1, 2, 3 …
    const reversed = [...mine].reverse()
    const res = reorderViews('accounts', reversed)
    for (const [i, id] of reversed.entries()) expect(res.views.find((v) => v.id === id)!.position).toBe(i + 1)
    const sorted = () => [...viewsOf('accounts')].sort((a, b) => a.position - b.position).map((v) => v.id)
    expect(sorted()).toEqual(reversed)
    const snapshot = getMeta().views
    // 1 つ足りない → 400
    expect(statusOf(() => reorderViews('accounts', reversed.slice(1)))).toBe(400)
    // 数は合っていても、1 つが他のテーブルのビュー → 400
    expect(statusOf(() => reorderViews('accounts', [...reversed.slice(1), other]))).toBe(400)
    // 他のテーブルのビューを足して数が多い → 400
    expect(statusOf(() => reorderViews('accounts', [...reversed, other]))).toBe(400)
    // どれも並びを変えない(他のテーブルも)
    expect(getMeta().views).toEqual(snapshot)
  })

  it('META-071 初めから入っているテーブル(system)を deleteObject → 400 で、GET /meta に残る', () => {
    const system = getMeta().objects.filter((o) => o.system).map((o) => o.key)
    expect(system).toContain('accounts')
    for (const key of system) {
      expect(statusOf(() => deleteObject(key)), key).toBe(400)
      expect(getMeta().objects.some((o) => o.key === key), key).toBe(true)
    }
    // system でないテーブルは同じ経路で消せる(400 は system だから)
    expect(statusOf(() => createObject(input('plain')))).toBeNull()
    expect(statusOf(() => deleteObject('plain'))).toBeNull()
    expect(getMeta().objects.some((o) => o.key === 'plain')).toBe(false)
  })

  it('META-072 deleteObject で GET /meta から消えるがレコードとビューは残り、restoreObject でテーブル・ビュー・レコードが全部戻る', () => {
    createObject(input('plain'))
    createView('plain', { name: '試しのビュー', type: 'list', config: { columns: [{ field: 'name' }] } })
    insert('plain', { name: '一件目' }, null)
    insert('plain', { name: '二件目' }, null)
    const before = getMeta()
    const object = before.objects.find((o) => o.key === 'plain')
    const views = before.views.filter((v) => v.object === 'plain')
    const rows = structuredClone(table('plain'))
    expect(views.map((v) => v.name)).toContain('試しのビュー')
    expect(rows).toHaveLength(2)

    deleteObject('plain')
    const trashed = getMeta()
    expect(trashed.objects.some((o) => o.key === 'plain')).toBe(false)
    expect(trashed.views.some((v) => v.object === 'plain')).toBe(false)
    // レコードは捨てない
    expect(table('plain')).toEqual(rows)

    restoreObject('plain')
    const after = getMeta()
    expect(after.objects.find((o) => o.key === 'plain')).toEqual(object)
    // ビューは消した間も残っていた(同じ ID・同じ定義で戻る)
    expect(after.views.filter((v) => v.object === 'plain')).toEqual(views)
    expect(table('plain')).toEqual(rows)
  })

  it('META-073 削除中のテーブルと同じ列名で createObject → 400 で、復元対象(定義・レコード)は捨てない', () => {
    createObject(input('plain'))
    insert('plain', { name: '残す一件' }, null)
    const object = getMeta().objects.find((o) => o.key === 'plain')
    const rows = structuredClone(table('plain'))
    deleteObject('plain')

    expect(statusOf(() => createObject({ ...input('plain'), label: '別のテーブル', fields: [{ key: 'title', label: '件名', type: 'text' }] }))).toBe(400)
    // 作られていない(GET /meta に出ない)し、レコードも上書きされていない
    expect(getMeta().objects.some((o) => o.key === 'plain')).toBe(false)
    expect(table('plain')).toEqual(rows)

    restoreObject('plain')
    expect(getMeta().objects.find((o) => o.key === 'plain')).toEqual(object)
    expect(table('plain')).toEqual(rows)
  })

  it('META-074 項目を外して保存しても列の値は行に残り、同じ列名・同じ型で戻すと型・参照先・semantic などは保管していた定義から、選択肢は本文から復活する', () => {
    const deals = () => getMeta().objects.find((o) => o.key === 'opportunities')!
    const fieldOf = (key: string) => deals().fields.find((f) => f.key === key)
    const before = deals()
    const kept = { close_date: fieldOf('close_date')!, primary_contact_id: fieldOf('primary_contact_id')!, type: fieldOf('type')! }
    expect(kept.close_date.semantic).toBe('deadline')
    expect(kept.primary_contact_id.target).toBe('contacts')
    expect(kept.type.in_create_form).toBe(false)
    const rows = structuredClone(table('opportunities'))
    expect(rows.some((r) => r.close_date != null && r.primary_contact_id != null && r.type != null)).toBe(true)
    // 本文に書ける属性だけを送る(画面・MCP の形)
    const bodyFields = before.fields
      .filter((f) => !f.readonly)
      .map(({ key, label, type, required, options, target, max_length, scale, placeholder }) => ({ key, label, type, required, options, target, max_length, scale, placeholder }))
    const removedKeys = Object.keys(kept)
    const body = (fields: ObjectInput['fields']): ObjectInput => ({ key: 'opportunities', label: before.label, icon: before.icon, color: before.color, fields })

    // 外して保存 → GET /meta から消えるが、列の値は行に残る
    expect(statusOf(() => updateObject('opportunities', body(bodyFields.filter((f) => !removedKeys.includes(f.key)))))).toBeNull()
    for (const key of removedKeys) expect(fieldOf(key), key).toBeUndefined()
    expect(table('opportunities')).toEqual(rows)

    // 同じ列名・同じ型で戻す。ラベルは変え、参照先は別のテーブルを送り、semantic・in_create_form は送らない。選択肢は減らして名前を変える
    const options: SelectOption[] = [
      { value: 'new', label: '新しい案件', color: 'violet' },
      { value: 'renewal', label: '更新', color: 'teal' },
    ]
    const back = body([
      ...bodyFields.filter((f) => !removedKeys.includes(f.key)),
      { key: 'close_date', label: '締め日', type: 'date' },
      { key: 'primary_contact_id', label: '窓口', type: 'relation', target: 'accounts' },
      { key: 'type', label: '区分', type: 'select', options },
    ])
    expect(statusOf(() => updateObject('opportunities', back))).toBeNull()
    // 型・参照先・画面から決められない属性は保管していた定義から、ラベルは本文から
    expect(fieldOf('close_date')).toEqual({ ...kept.close_date, label: '締め日' })
    expect(fieldOf('primary_contact_id')).toEqual({ ...kept.primary_contact_id, label: '窓口' })
    // 選択肢は本文のもの(本文に無い expansion は戻らない)
    expect(fieldOf('type')).toEqual({ ...kept.type, label: '区分', options })
    // 列の値はそのまま読める
    expect(table('opportunities')).toEqual(rows)
  })

  it('META-075 数値の項目を外し、同じ列名で参照型を足す → 400 で、保管していた定義と列の値は捨てない', () => {
    const plain = () => getMeta().objects.find((o) => o.key === 'plain')!
    const name = { key: 'name', label: '名前', type: 'text' as const }
    const count = { key: 'headcount', label: '人数', type: 'number' as const, scale: 0 }
    createObject({ ...input('plain'), fields: [name, count] })
    insert('plain', { name: '残す一件', headcount: 12 }, null)
    const kept = plain().fields.find((f) => f.key === 'headcount')!
    const rows = structuredClone(table('plain'))

    // 数値の項目を外して保存
    expect(statusOf(() => updateObject('plain', { ...input('plain'), fields: [name] }))).toBeNull()
    expect(plain().fields.some((f) => f.key === 'headcount')).toBe(false)

    // 同じ列名で参照型を足す → 400。定義は変わらず、列の値もそのまま
    const before = plain()
    expect(statusOf(() => updateObject('plain', { ...input('plain'), fields: [name, { key: 'headcount', label: '担当先', type: 'relation', target: 'accounts' }] }))).toBe(400)
    expect(plain()).toEqual(before)
    expect(table('plain')).toEqual(rows)

    // 保管していた定義は捨てていない(同じ型で戻せば数値の項目として復活する)
    expect(statusOf(() => updateObject('plain', { ...input('plain'), fields: [name, count] }))).toBeNull()
    expect(plain().fields.find((f) => f.key === 'headcount')).toEqual(kept)
    expect(table('plain')).toEqual(rows)
  })

  it('META-076 参照先のテーブルを削除すると参照元の relation の項目は GET /meta から隠れ、参照先を戻すと項目も戻る', () => {
    const source = () => getMeta().objects.find((o) => o.key === 'source')!
    createObject(input('plain'))
    const target = insert('plain', { name: '参照される一件' }, null)
    createObject({ ...input('source'), fields: [{ key: 'name', label: '名前', type: 'text' }, { key: 'plain_id', label: '参照先', type: 'relation', target: 'plain' }] })
    insert('source', { name: '参照する一件', plain_id: target.record.id }, null)
    expect(table('source')[0]!.plain_id).toBe(target.record.id)
    const before = source()
    const link = before.fields.find((f) => f.key === 'plain_id')!
    expect(link.target).toBe('plain')
    const rows = structuredClone(table('source'))

    // 参照先を削除 → 参照元のテーブルは残り、relation の項目だけ隠れる(列の値は行に残る)
    deleteObject('plain')
    expect(source().fields.some((f) => f.key === 'plain_id')).toBe(false)
    expect(source().fields.some((f) => f.key === 'name')).toBe(true)
    expect(table('source')).toEqual(rows)

    // 参照先を戻す → 項目も同じ定義で戻る
    restoreObject('plain')
    expect(source().fields.find((f) => f.key === 'plain_id')).toEqual(link)
    expect(source()).toEqual(before)
    expect(table('source')).toEqual(rows)
  })

  it('META-077 参照先が削除中のあいだに参照元のテーブルの名前だけ変えて保存しても、本文に無い隠れた relation の項目は外れず、参照先を戻すと同じ定義で戻る', () => {
    const source = () => getMeta().objects.find((o) => o.key === 'source')!
    createObject(input('plain'))
    const target = insert('plain', { name: '参照される一件' }, null)
    createObject({ ...input('source'), fields: [{ key: 'name', label: '名前', type: 'text' }, { key: 'plain_id', label: '参照先', type: 'relation', target: 'plain' }] })
    insert('source', { name: '参照する一件', plain_id: target.record.id }, null)
    const before = source()
    const link = before.fields.find((f) => f.key === 'plain_id')!
    const rows = structuredClone(table('source'))

    // 参照先を削除 → relation の項目は GET /meta から隠れる
    deleteObject('plain')
    const hidden = source()
    expect(hidden.fields.some((f) => f.key === 'plain_id')).toBe(false)

    // 画面は GET /meta で見えている項目だけを本文に載せて、名前だけ変えて保存する(隠れた項目は本文に無い)
    const bodyFields = hidden.fields
      .filter((f) => !f.readonly)
      .map(({ key, label, type, required, options, target, max_length, scale, placeholder }) => ({ key, label, type, required, options, target, max_length, scale, placeholder }))
    expect(bodyFields.some((f) => f.key === 'plain_id')).toBe(false)
    expect(statusOf(() => updateObject('source', { key: 'source', label: '名前を変えたテーブル', icon: hidden.icon, color: hidden.color, fields: bodyFields }))).toBeNull()
    expect(source().label).toBe('名前を変えたテーブル')
    expect(source().fields.some((f) => f.key === 'plain_id')).toBe(false)
    expect(table('source')).toEqual(rows)

    // 参照先を戻す → 隠れていた項目は外れておらず、同じ定義で戻る(名前の変更はそのまま)
    restoreObject('plain')
    expect(source().fields.find((f) => f.key === 'plain_id')).toEqual(link)
    expect(source()).toEqual({ ...before, label: '名前を変えたテーブル' })
    expect(table('source')).toEqual(rows)
  })

  it('META-078 テーブルを削除すると活動の関連先の targets から消え、そのテーブルを指す polymorphic の値は行に残る', () => {
    const targets = () => getMeta().objects.find((o) => o.key === 'activities')!.fields.find((f) => f.key === 'related')!.targets
    createObject(input('trial'))
    expect(targets()).toContain('trial')
    const target = insert('trial', { name: '関連先の一件' }, null)
    const activity = insert('activities', { subject: '試しの活動', related_object: 'trial', related_id: target.record.id }, null)
    const row = () => table('activities').find((r) => r.id === activity.record.id)!
    expect(row().related_object).toBe('trial')
    const before = structuredClone(row())
    const others = targets()!.filter((k) => k !== 'trial')

    // テーブルを削除 → 関連先の targets からだけ消え(ほかの関連先は残る)、行の値はそのまま
    deleteObject('trial')
    expect(targets()).toEqual(others)
    expect(row()).toEqual(before)
    expect(row().related_object).toBe('trial')
    expect(row().related_id).toBe(target.record.id)

    // 戻す → targets にも戻る
    restoreObject('trial')
    expect(targets()).toEqual([...others, 'trial'])
    expect(row()).toEqual(before)
  })
  it('META-090 項目を外すとその項目を指す一覧の列・並びは GET /meta で外れ、保存してある定義には残り、戻すと列も並びも元の位置・幅で戻る', () => {
    const deals = () => getMeta().objects.find((o) => o.key === 'opportunities')!
    const list = () => getMeta().views.find((v) => v.object === 'opportunities' && v.type === 'list')!
    const before = deals()
    const beforeList = list()
    if (beforeList.type !== 'list') throw new Error('一覧のビューがありません')
    // close_date は一覧の列(末尾ではない位置・既定と違う幅)と並びの両方に使われている
    const index = beforeList.config.columns.findIndex((c) => c.field === 'close_date')
    expect(index).toBeGreaterThan(0)
    expect(index).toBeLessThan(beforeList.config.columns.length - 1)
    expect(beforeList.config.columns[index]!.width).toBe(130)
    expect(beforeList.config.sort).toEqual([{ field: 'close_date', dir: 'asc' }])
    const bodyFields = before.fields
      .filter((f) => !f.readonly)
      .map(({ key, label, type, required, options, target, max_length, scale, placeholder }) => ({ key, label, type, required, options, target, max_length, scale, placeholder }))
    const body = (fields: ObjectInput['fields']): ObjectInput => ({ key: 'opportunities', label: before.label, icon: before.icon, color: before.color, fields })

    // 外して保存 → GET /meta の一覧から列と並びが外れる(ほかの列はそのまま)
    expect(statusOf(() => updateObject('opportunities', body(bodyFields.filter((f) => f.key !== 'close_date'))))).toBeNull()
    const hidden = list()
    if (hidden.type !== 'list') throw new Error('一覧のビューがありません')
    expect(hidden.id).toBe(beforeList.id)
    expect(hidden.config.columns).toEqual(beforeList.config.columns.filter((c) => c.field !== 'close_date'))
    expect(hidden.config.sort).toEqual([])

    // 同じ列名・同じ型で戻す → 保存してある定義に残っていたので、列は元の位置・幅で、並びも元どおりに戻る(末尾に既定の幅で足されるのではない)
    expect(statusOf(() => updateObject('opportunities', body(bodyFields)))).toBeNull()
    expect(list()).toEqual(beforeList)
  })

  it('META-091 項目を外すとその項目を指すビューの条件も外れ、and の中の 1 条件なら他は残り、全部無くなれば条件ごと無くなる', () => {
    const before = getMeta().objects.find((o) => o.key === 'opportunities')!
    const bodyFields = before.fields
      .filter((f) => !f.readonly)
      .map(({ key, label, type, required, options, target, max_length, scale, placeholder }) => ({ key, label, type, required, options, target, max_length, scale, placeholder }))
    const body = (fields: ObjectInput['fields']): ObjectInput => ({ key: 'opportunities', label: before.label, icon: before.icon, color: before.color, fields })
    const list = (name: string, filter: Extract<ViewInput, { type: 'list' }>['config']['filter']): ViewInput => ({
      name,
      type: 'list',
      config: { columns: [{ field: 'name' }, { field: 'stage' }], filter },
    })
    // close_date を指す条件と、指さない条件を and に並べたビュー(or の群の中にも 1 つずつ)
    const mixed = {
      and: [
        { field: 'close_date', op: 'lte' as const, value: '$today+30' },
        { field: 'amount', op: 'gte' as const, value: 1000000 },
        { or: [{ field: 'close_date', op: 'is_empty' as const }, { field: 'lead_source', op: 'is_not_empty' as const }] },
      ],
    }
    // close_date を指す条件だけのビュー(and の直下と、その中の or の群)
    const only = { and: [{ field: 'close_date', op: 'is_not_empty' as const }, { or: [{ field: 'close_date', op: 'gte' as const, value: '$start_of_month' }] }] }
    const mixedId = createView('opportunities', list('期日の近い大口', mixed)).views.find((v) => v.name === '期日の近い大口')!.id
    const onlyId = createView('opportunities', list('期日のあるもの', only)).views.find((v) => v.name === '期日のあるもの')!.id
    const view = (id: string) => getMeta().views.find((v) => v.id === id)!

    // 外して保存 → close_date を指す条件だけが外れ、ほかの条件は残る。空になった or の群・and の群は群ごと外れる
    expect(statusOf(() => updateObject('opportunities', body(bodyFields.filter((f) => f.key !== 'close_date'))))).toBeNull()
    const kept = view(mixedId)
    if (kept.type !== 'list') throw new Error('一覧のビューがありません')
    expect(kept.config.filter).toEqual({ and: [{ field: 'amount', op: 'gte', value: 1000000 }, { or: [{ field: 'lead_source', op: 'is_not_empty' }] }] })
    const emptied = view(onlyId)
    if (emptied.type !== 'list') throw new Error('一覧のビューがありません')
    expect(emptied.config.filter).toBeUndefined()
    // 条件が無くなったビューも消えず、列はそのまま
    expect(emptied.config.columns).toEqual([{ field: 'name' }, { field: 'stage' }])

    // 同じ列名・同じ型で戻す → 保存してある定義には残っていたので、条件も元どおりに戻る
    expect(statusOf(() => updateObject('opportunities', body(bodyFields)))).toBeNull()
    expect(view(mixedId).config).toEqual(list('', mixed).config)
    expect(view(onlyId).config).toEqual(list('', only).config)
  })

  it('META-092 項目を外したあと、そのビューを GET /meta の定義のまま改名だけして updateView しても 400 にならない', () => {
    const before = getMeta().objects.find((o) => o.key === 'opportunities')!
    const bodyFields = before.fields
      .filter((f) => !f.readonly)
      .map(({ key, label, type, required, options, target, max_length, scale, placeholder }) => ({ key, label, type, required, options, target, max_length, scale, placeholder }))
    // close_date を列・並び・条件・カードの項目で指す一覧とカンバン
    const listId = createView('opportunities', {
      name: '期日順',
      type: 'list',
      config: {
        columns: [{ field: 'name' }, { field: 'close_date', width: 120 }, { field: 'stage' }],
        sort: [{ field: 'close_date', dir: 'asc' }],
        filter: { and: [{ field: 'close_date', op: 'is_not_empty' }, { field: 'amount', op: 'gte', value: 1000000 }] },
      },
    }).views.find((v) => v.name === '期日順')!.id
    const kanbanId = createView('opportunities', {
      name: '期日つきカンバン',
      type: 'kanban',
      config: { group_by: 'stage', card_fields: ['amount', 'close_date'], sort: [{ field: 'close_date', dir: 'desc' }], filter: { field: 'close_date', op: 'is_not_empty' } },
    }).views.find((v) => v.name === '期日つきカンバン')!.id
    const view = (id: string) => getMeta().views.find((v) => v.id === id)!

    expect(statusOf(() => updateObject('opportunities', { key: 'opportunities', label: before.label, icon: before.icon, color: before.color, fields: bodyFields.filter((f) => f.key !== 'close_date') }))).toBeNull()

    // 画面と同じく、GET /meta で受け取った定義(外れた項目は見えない)に名前だけ変えて送る
    for (const [id, name] of [
      [listId, '期日順(改)'],
      [kanbanId, '期日つきカンバン(改)'],
    ] as const) {
      const { id: _id, object: _object, position: _position, ...rest } = view(id)
      const shown = rest.config
      expect(statusOf(() => updateView(id, { ...rest, name } as ViewInput))).toBeNull()
      expect(view(id).name).toBe(name)
      expect(view(id).config).toEqual(shown)
    }
    const list = view(listId)
    if (list.type !== 'list') throw new Error('一覧のビューがありません')
    expect(list.config.columns).toEqual([{ field: 'name' }, { field: 'stage' }])
    const kanban = view(kanbanId)
    if (kanban.type !== 'kanban') throw new Error('カンバンのビューがありません')
    expect(kanban.config.card_fields).toEqual(['amount'])
  })
  it('META-093 カンバンの group_by の項目を外すとそのビューは GET /meta に出ず、戻すと同じ定義で出る', () => {
    const before = getMeta().objects.find((o) => o.key === 'opportunities')!
    const bodyFields = before.fields
      .filter((f) => !f.readonly)
      .map(({ key, label, type, required, options, target, max_length, scale, placeholder }) => ({ key, label, type, required, options, target, max_length, scale, placeholder }))
    const body = (fields: ObjectInput['fields']): ObjectInput => ({ key: 'opportunities', label: before.label, icon: before.icon, color: before.color, fields })
    // 選択肢の項目「確度」を足し、それで分けるカンバンを作る
    const withRank = [...bodyFields, { key: 'rank', label: '確度', type: 'select' as const, options: [{ value: 'a', label: 'A', color: 'green' as TagColor }, { value: 'b', label: 'B', color: 'gray' as TagColor }] }]
    expect(statusOf(() => updateObject('opportunities', body(withRank)))).toBeNull()
    const kanbanId = createView('opportunities', {
      name: '確度で分ける',
      type: 'kanban',
      config: { group_by: 'rank', card_fields: ['amount'] },
    }).views.find((v) => v.name === '確度で分ける')!.id
    const views = () => getMeta().views.filter((v) => v.object === 'opportunities')
    const shown = views()
    const kanban = shown.find((v) => v.id === kanbanId)!
    expect(kanban.type).toBe('kanban')

    // 分ける項目を外す → そのカンバンだけが GET /meta に出なくなる(ほかのビューはそのまま)
    expect(statusOf(() => updateObject('opportunities', body(bodyFields)))).toBeNull()
    expect(views().find((v) => v.id === kanbanId)).toBeUndefined()
    expect(views().map((v) => v.id)).toEqual(shown.filter((v) => v.id !== kanbanId).map((v) => v.id))

    // 同じ列名・同じ型で戻す → 同じ定義で出る
    expect(statusOf(() => updateObject('opportunities', body(withRank)))).toBeNull()
    expect(views().find((v) => v.id === kanbanId)).toEqual(kanban)
  })
  it('META-094 レポートの部品が指す項目を外すとその部品だけ外れ、全部無くなればビューが出ない。関連先の related_object を指す部品は残る', () => {
    const before = getMeta().objects.find((o) => o.key === 'activities')!
    const bodyFields = before.fields
      .filter((f) => !f.readonly)
      .map(({ key, label, type, required, options, target, max_length, scale, placeholder }) => ({ key, label, type, required, options, target, max_length, scale, placeholder }))
    const body = (fields: ObjectInput['fields']): ObjectInput => ({ key: 'activities', label: before.label, icon: before.icon, color: before.color, fields })
    // 数値の項目「所要分」を足し、それを指す部品と関連先を指す部品を持つレポートを 2 つ作る
    const withMinutes = [...bodyFields, { key: 'minutes', label: '所要分', type: 'number' as const }]
    expect(statusOf(() => updateObject('activities', body(withMinutes)))).toBeNull()
    const total = { id: 'w-total', type: 'stat' as const, title: '所要分の合計', measure: { op: 'sum' as const, field: 'minutes' }, format: 'number' as const }
    const byOwner = { id: 'w-owner', type: 'bar' as const, title: '担当者ごとの所要分', group_by: { field: 'owner_id' }, measure: { op: 'sum' as const, field: 'minutes' }, format: 'number' as const, color: 'single' as const }
    const byRelated = { id: 'w-related', type: 'column' as const, title: '関連先ごとの件数', group_by: { field: 'related_object' }, measure: { op: 'count' as const }, format: 'number' as const, color: 'single' as const }
    const mixedId = createView('activities', { name: '混在', type: 'report', config: { widgets: [total, byOwner, byRelated] } }).views.find((v) => v.name === '混在')!.id
    const onlyId = createView('activities', { name: '所要分だけ', type: 'report', config: { widgets: [total, byOwner] } }).views.find((v) => v.name === '所要分だけ')!.id
    const views = () => getMeta().views.filter((v) => v.object === 'activities')
    const shown = views()
    const mixed = shown.find((v) => v.id === mixedId)!
    const only = shown.find((v) => v.id === onlyId)!
    expect(mixed.type === 'report' && mixed.config.widgets.map((w) => w.id)).toEqual(['w-total', 'w-owner', 'w-related'])

    // 所要分を外す → 所要分を指す部品だけが外れ、関連先を指す部品は残る。部品が全部無くなったレポートは出ない
    expect(statusOf(() => updateObject('activities', body(bodyFields)))).toBeNull()
    const after = views().find((v) => v.id === mixedId)!
    expect(after.type === 'report' && after.config.widgets).toEqual([byRelated])
    expect(views().find((v) => v.id === onlyId)).toBeUndefined()
    expect(views().map((v) => v.id)).toEqual(shown.filter((v) => v.id !== onlyId).map((v) => v.id))

    // 同じ列名・同じ型で戻す → どちらのレポートも同じ定義で出る
    expect(statusOf(() => updateObject('activities', body(withMinutes)))).toBeNull()
    expect(views().find((v) => v.id === mixedId)).toEqual(mixed)
    expect(views().find((v) => v.id === onlyId)).toEqual(only)
  })

  it('META-095 subtitle_field の項目を外すと subtitle_field が消え、参照・検索の添え字も出ない(無い項目を指さない)', () => {
    const before = getMeta().objects.find((o) => o.key === 'accounts')!
    expect(before.subtitle_field).toBe('industry')
    const bodyFields = before.fields
      .filter((f) => !f.readonly)
      .map(({ key, label, type, required, options, target, max_length, scale, placeholder }) => ({ key, label, type, required, options, target, max_length, scale, placeholder }))
    const body = (fields: ObjectInput['fields']): ObjectInput => ({ key: 'accounts', label: before.label, icon: before.icon, color: before.color, fields })
    const accounts = () => getMeta().objects.find((o) => o.key === 'accounts')!
    const id = table('accounts').find((r) => r.name === '株式会社アオバ精機')!.id as string
    const hit = () => searchAll('アオバ精機').find((h) => h.object === 'accounts' && h.id === id)!
    expect(refOf('accounts', id)?.subtitle).toBe('製造')
    expect(hit().subtitle).toBe('製造')

    // subtitle_field 以外の項目を外しても、subtitle_field は残る
    expect(statusOf(() => updateObject('accounts', body(bodyFields.filter((f) => f.key !== 'phone'))))).toBeNull()
    expect(accounts().subtitle_field).toBe('industry')

    // subtitle_field の項目を外す → subtitle_field が消え、名前に添える文字も出ない
    expect(statusOf(() => updateObject('accounts', body(bodyFields.filter((f) => f.key !== 'phone' && f.key !== 'industry'))))).toBeNull()
    const after = accounts()
    expect(after.fields.some((f) => f.key === 'industry')).toBe(false)
    expect(after.subtitle_field).toBeUndefined()
    expect(after.name_field).toBe('name')
    expect(refOf('accounts', id)).toEqual({ id, name: '株式会社アオバ精機', subtitle: null })
    expect(hit().subtitle).toBeNull()
  })
})

// テストケース表: docs/tests/io.md
describe('一覧の読み取り(mocks/engine.ts の query)', () => {
  beforeEach(() => resetTables())

  /** その選択肢の項目の、定義の順に並んだ値 */
  const optionValues = (object: string, field: string) =>
    getMeta().objects.find((o) => o.key === object)!.fields.find((f) => f.key === field)!.options!.map((o) => o.value)

  it('IO-020 選択肢の列で並べると定義順(P1 → P4、見込み → 失注)になり、値や表示名の文字順ではない', () => {
    const stages = optionValues('opportunities', 'stage')
    expect(stages[0]).toBe('lead')
    expect(stages.at(-1)).toBe('lost')
    // 値の文字順(hearing, lead, lost, …)とも表示名の文字順とも違う並びであることを前提として確かめる
    expect([...stages].sort()).not.toEqual(stages)

    const asc = query('opportunities', { sort: [{ field: 'stage', dir: 'asc' }] }, null).records.map((r) => r.stage as string)
    expect(asc.length).toBe(table('opportunities').length)
    // 全部の選択肢が並びに出ていて、定義順に束になっている
    expect([...new Set(asc)]).toEqual(stages)
    expect(asc.map((v) => stages.indexOf(v))).toEqual([...asc.map((v) => stages.indexOf(v))].sort((a, b) => a - b))
    expect(asc[0]).toBe('lead')
    expect(asc.at(-1)).toBe('lost')

    // 降順は定義の逆順(失注 → 見込み)
    const desc = query('opportunities', { sort: [{ field: 'stage', dir: 'desc' }] }, null).records.map((r) => r.stage as string)
    expect([...new Set(desc)]).toEqual([...stages].reverse())

    // タスクの優先度: P1 → P4、降順は P4 → P1
    const priorities = optionValues('tasks', 'priority')
    expect(priorities).toEqual(['p1', 'p2', 'p3', 'p4'])
    const pAsc = query('tasks', { sort: [{ field: 'priority', dir: 'asc' }] }, null).records.map((r) => r.priority as string)
    expect([...new Set(pAsc)]).toEqual(priorities)
    const pDesc = query('tasks', { sort: [{ field: 'priority', dir: 'desc' }] }, null).records.map((r) => r.priority as string)
    expect([...new Set(pDesc)]).toEqual([...priorities].reverse())
  })
  it('IO-021 参照・利用者の列で並べると参照先の表示名の順になり、ID の順ではない', () => {
    const ja = (a: string, b: string) => a.localeCompare(b, 'ja')
    const accountName = (id: string) => refOf('accounts', id)!.name

    // 参照(取引先): 取引先名の順に束になる。ID の順とは違う並びであることを前提として確かめる
    const ids = [...new Set(table('opportunities').map((r) => r.account_id as string))]
    const byName = [...ids].sort((a, b) => ja(accountName(a), accountName(b)))
    expect([...ids].sort()).not.toEqual(byName)

    const asc = query('opportunities', { sort: [{ field: 'account_id', dir: 'asc' }] }, null)
    expect(asc.records.length).toBe(table('opportunities').length)
    const ascIds = asc.records.map((r) => r.account_id as string)
    expect([...new Set(ascIds)]).toEqual(byName)
    // 返した参照(references)の表示名で見ても順に並んでいる
    const ascNames = ascIds.map((id) => asc.references.accounts![id]!.name)
    expect(ascNames).toEqual([...ascNames].sort(ja))

    const desc = query('opportunities', { sort: [{ field: 'account_id', dir: 'desc' }] }, null).records.map((r) => r.account_id as string)
    expect([...new Set(desc)]).toEqual([...byName].reverse())

    // 利用者(担当者): 名前の順(Misaki → Takuya)。ID の順(Takuya が先)とは逆
    const owners = getMeta().users
    const takuya = owners.find((u) => u.name === 'Takuya')!.id
    const misaki = owners.find((u) => u.name === 'Misaki')!.id
    expect(takuya < misaki).toBe(true)
    const oAsc = query('opportunities', { sort: [{ field: 'owner_id', dir: 'asc' }] }, null).records.map((r) => r.owner_id)
    expect([...new Set(oAsc)]).toEqual([misaki, takuya])
    const oDesc = query('opportunities', { sort: [{ field: 'owner_id', dir: 'desc' }] }, null).records.map((r) => r.owner_id)
    expect([...new Set(oDesc)]).toEqual([takuya, misaki])
  })

  it('IO-022 limit: 0 は records が空で total は件数になり、offset で続きを取れる', () => {
    const sort = [{ field: 'name', dir: 'asc' as const }]
    const all = query('opportunities', { sort }, null)
    const n = table('opportunities').length
    expect(n).toBeGreaterThan(3)
    expect(all.total).toBe(n)

    // 件数だけ(サイドバーの件数): 行も参照も返さない
    const count = query('opportunities', { sort, limit: 0 }, null)
    expect(count.records).toEqual([])
    expect(count.total).toBe(n)
    expect(count.references).toEqual({})

    // 絞り込み後の件数を返す
    const filter = { field: 'stage', op: 'eq' as const, value: all.records[0]!.stage }
    const filtered = query('opportunities', { filter }, null).records.length
    expect(filtered).toBeLessThan(n)
    expect(query('opportunities', { filter, limit: 0 }, null).total).toBe(filtered)

    // offset で続きが取れ、つなげると全件の並びと一致する
    const ids = all.records.map((r) => r.id)
    const pages: unknown[] = []
    for (let offset = 0; offset < n; offset += 3) {
      const page = query('opportunities', { sort, limit: 3, offset }, null)
      expect(page.total).toBe(n)
      expect(page.records.length).toBe(Math.min(3, n - offset))
      pages.push(...page.records.map((r) => r.id))
    }
    expect(pages).toEqual(ids)
    // limit を省けば offset から最後まで。末尾を越えた offset は空
    expect(query('opportunities', { sort, offset: 2 }, null).records.map((r) => r.id)).toEqual(ids.slice(2))
    expect(query('opportunities', { sort, offset: n, limit: 3 }, null)).toMatchObject({ records: [], total: n })
  })

  it('IO-023 q はひらがな・カタカナ、全角・半角、大文字・小文字を区別せずに当たる', () => {
    const names = (q: string) => query('opportunities', { q }, null).records.map((r) => r.name as string)

    // カタカナの名前に、ひらがな・半角カタカナで打っても当たる
    const cloud = names('クラウド')
    expect(cloud).toContain('配車管理のクラウド移行')
    expect(cloud.length).toBeLessThan(table('opportunities').length)
    expect(names('くらうど')).toEqual(cloud)
    expect(names('ｸﾗｳﾄﾞ')).toEqual(cloud)

    // 英字: 大文字・小文字、全角・半角を問わない
    const saas = names('SaaS')
    expect(saas).toContain('共同開発: 予約管理 SaaS')
    for (const q of ['saas', 'SAAS', 'ｓａａｓ', 'ＳａａＳ']) expect(names(q)).toEqual(saas)
    const wifi = names('Wi-Fi')
    expect(wifi).toContain('工場 Wi-Fi 更改')
    expect(names('ｗｉ－ｆｉ')).toEqual(wifi)

    // 当たらない語は空(正規化で何にでも当たるようになってはいない)
    expect(names('くらうどさーす')).toEqual([])
  })

  it('IO-024 q は richtext をタグを落とした文字で当てる(<strong> の中の語も、タグをまたぐ語も当たり、タグ名には当たらない)', () => {
    const subjects = (q: string) => query('activities', { q }, null).records.map((r) => r.subject as string)
    // 本文は <p>…確認。<strong>帳票出力の遅さ</strong>が最優先。</p><ul><li>…</li></ul>
    const row = table('activities').find((r) => r.subject === '要件の確認と概算の説明')!
    expect(row.body as string).toContain('<strong>帳票出力の遅さ</strong>')

    // <strong> の中の語
    expect(subjects('帳票出力の遅さ')).toEqual(['要件の確認と概算の説明'])
    expect(subjects('オフライン動作')).toEqual(['現地調査の所感'])
    // タグの境目をまたぐ語(生の HTML のままでは当たらない)
    expect(subjects('確認。帳票出力')).toEqual(['要件の確認と概算の説明'])
    expect(subjects('遅さが最優先')).toEqual(['要件の確認と概算の説明'])

    // タグ名・属性の文字には当たらない
    for (const q of ['strong', '<strong>', '<li>', '</p>']) expect(subjects(q), q).toEqual([])
  })

  it('IO-025 references には、返した行が指す参照・利用者・関連先(polymorphic)の表示名が、その ID の分だけ入る', () => {
    /** 行が指す ID を、参照先のテーブルごとに集めたもの(期待値) */
    const expected = (rows: Record<string, unknown>[], pick: (r: Record<string, unknown>) => [string, unknown][]) => {
      const out: Record<string, string[]> = {}
      for (const [object, id] of rows.flatMap(pick)) if (typeof id === 'string') (out[object] ??= []).push(id)
      return Object.fromEntries(Object.entries(out).map(([k, ids]) => [k, [...new Set(ids)].sort()]))
    }
    const actual = (refs: Record<string, Record<string, { id: string }>>) =>
      Object.fromEntries(Object.entries(refs).map(([k, bucket]) => [k, Object.keys(bucket).sort()]))
    /** 表示名が refOf(参照先の name_field)と同じで、キーと id が一致する */
    const expectNames = (refs: Record<string, Record<string, { id: string; name: string }>>) => {
      for (const [object, bucket] of Object.entries(refs))
        for (const [id, ref] of Object.entries(bucket)) {
          expect(ref.id).toBe(id)
          expect(ref.name, `${object}/${id}`).toBe(refOf(object, id)!.name)
          expect(ref.name).not.toBe('')
        }
    }

    // 商談: 参照(取引先・主担当の責任者)と利用者(担当者)。3 件のページなら、その 3 件が指す分だけ
    const opps = query('opportunities', { sort: [{ field: 'name', dir: 'asc' }], limit: 3 }, null)
    const oppPick = (r: Record<string, unknown>): [string, unknown][] => [
      ['accounts', r.account_id],
      ['contacts', r.primary_contact_id],
      ['users', r.owner_id],
    ]
    expect(actual(opps.references)).toEqual(expected(opps.records, oppPick))
    expectNames(opps.references)
    // 全件の参照先より少ない(ページに無い行の参照先は入らない)
    const allAccounts = new Set(table('opportunities').map((r) => r.account_id))
    expect(Object.keys(opps.references.accounts!).length).toBeLessThan(allAccounts.size)

    // 活動: 関連先(取引先と商談が混ざる)と利用者。関連先の ID は related_object のテーブルに入る
    const acts = query('activities', {}, null)
    expect(new Set(acts.records.map((r) => r.related_object))).toEqual(new Set(['accounts', 'opportunities']))
    const actPick = (r: Record<string, unknown>): [string, unknown][] => [
      [r.related_object as string, r.related_id],
      ['users', r.owner_id],
    ]
    expect(actual(acts.references)).toEqual(expected(acts.records, actPick))
    expectNames(acts.references)

    // タスク: 参照(責任者・繰り返し元)、関連先(空の行もある)、利用者。空の値は references に何も足さない
    const tasks = query('tasks', {}, null)
    expect(tasks.records.some((r) => r.related_object == null)).toBe(true)
    const taskPick = (r: Record<string, unknown>): [string, unknown][] => [
      ['contacts', r.contact_id],
      ['tasks', r.repeat_of],
      ...(typeof r.related_object === 'string' ? [[r.related_object, r.related_id] as [string, unknown]] : []),
      ['users', r.assignee_id],
    ]
    expect(actual(tasks.references)).toEqual(expected(tasks.records, taskPick))
    expectNames(tasks.references)
  })

  it('IO-026 searchAll は名前に当たったレコードを先に出し、1 テーブル 6 件までに切り、サイドバーに出していない活動も探す', () => {
    const names = (q: string, object: string) => searchAll(q).filter((h) => h.object === object).map((h) => h.name)

    // 取引先の「の」: 当たる 13 件のうち、名前に「ノ」を含む 3 件が先。表の順では名前以外で当たる行が前にある
    expect(query('accounts', { q: 'の' }, null).total).toBe(13)
    const accounts = names('の', 'accounts')
    expect(accounts).toHaveLength(6)
    expect(new Set(accounts.slice(0, 3))).toEqual(new Set(['株式会社ミドリノ不動産', '株式会社コトノハ出版', '株式会社ツキノワフーズ']))
    expect(accounts.slice(3).every((n) => !/[のノ]/.test(n))).toBe(true)
    const tableOrder = table('accounts').map((r) => r.name as string)
    expect(tableOrder.indexOf('株式会社アオバ精機')).toBeLessThan(tableOrder.indexOf('株式会社ミドリノ不動産'))

    // どのテーブルも、出るのは当たった件数と 6 の小さい方(タスクは 32 件当たって 6 件)
    for (const object of ['accounts', 'contacts', 'opportunities', 'tasks', 'activities']) {
      const total = query(object, { q: 'の' }, null).total
      expect(names('の', object), object).toHaveLength(Math.min(6, total))
    }
    expect(query('tasks', { q: 'の' }, null).total).toBe(32)

    // 活動はサイドバーに出していないが、検索の対象。本文だけで当たる行は、件名で当たる行の後
    expect(getMeta().objects.find((o) => o.key === 'activities')!.in_sidebar).toBe(false)
    const subjects = table('activities').map((r) => r.subject as string)
    expect(subjects.indexOf('要件の確認と概算の説明')).toBeLessThan(subjects.indexOf('見積の質問に回答'))
    expect(names('見積', 'activities')).toEqual(['見積の質問に回答', '要件の確認と概算の説明'])
  })
})

describe('集計(mocks/engine.ts の aggregate)', () => {
  beforeEach(() => resetTables())

  it('IO-027 aggregate の count は条件に合う全行数(値が空でも数える)、sum / avg は数値の行だけ(0 件なら 0)、weight_field は値 × 百分率 / 100 を足す', () => {
    createObject({
      key: 'deals',
      label: '試しの案件',
      icon: 'box',
      color: 'blue',
      fields: [
        { key: 'name', label: '名前', type: 'text' },
        { key: 'kind', label: '区分', type: 'text' },
        { key: 'amount', label: '金額', type: 'number' },
        { key: 'rate', label: '確度', type: 'percent' },
      ],
    })
    insert('deals', { name: 'A', kind: 'x', amount: 1000, rate: 50 }, null)
    insert('deals', { name: 'B', kind: 'x', amount: 300, rate: 10 }, null)
    insert('deals', { name: 'C', kind: 'x', amount: null, rate: 80 }, null)
    insert('deals', { name: 'D', kind: 'x', amount: 200, rate: null }, null)
    insert('deals', { name: 'E', kind: 'y', amount: null, rate: null }, null)
    insert('deals', { name: 'F', kind: 'z', amount: 999, rate: 100 }, null)
    const x = { field: 'kind', op: 'eq' as const, value: 'x' }
    const y = { field: 'kind', op: 'eq' as const, value: 'y' }
    const value = (params: Parameters<typeof aggregate>[1]) => {
      const rows = aggregate('deals', params, null)
      expect(rows).toHaveLength(1)
      return rows[0]!.value
    }

    // count: 条件に合う 4 行。金額が空の C も数える。項目を指定しても空の行を落とさない
    expect(value({ filter: x, measure: { op: 'count' } })).toBe(4)
    expect(value({ filter: x, measure: { op: 'count', field: 'amount' } })).toBe(4)
    expect(value({ measure: { op: 'count' } })).toBe(6)

    // sum / avg: 数値の行(A・B・D)だけ。avg は 3 行で割る(空の C を分母に入れると 375 になる)
    expect(value({ filter: x, measure: { op: 'sum', field: 'amount' } })).toBe(1500)
    expect(value({ filter: x, measure: { op: 'avg', field: 'amount' } })).toBe(500)

    // 数値の行が 0 件なら sum も avg も 0
    expect(value({ filter: y, measure: { op: 'sum', field: 'amount' } })).toBe(0)
    expect(value({ filter: y, measure: { op: 'avg', field: 'amount' } })).toBe(0)
    expect(value({ filter: y, measure: { op: 'count' } })).toBe(1)

    // weight_field: A は 1000 × 50 / 100 = 500、B は 300 × 10 / 100 = 30。金額が空の C は足さない
    // (確度が空の行の扱いは定義に無いので、D は含めない)
    const weighted = (filter: Parameters<typeof aggregate>[1]['filter']) => value({ filter, measure: { op: 'sum', field: 'amount', weight_field: 'rate' } })
    expect(weighted({ field: 'name', op: 'in', value: ['A', 'B'] })).toBe(530)
    expect(weighted({ field: 'name', op: 'in', value: ['A', 'B', 'C'] })).toBe(530)
    expect(weighted({ field: 'name', op: 'eq', value: 'F' })).toBe(999)
  })
  it('IO-028 aggregate の group_by が選択肢なら定義順、order: value_desc なら値の大きい順で、値が空のグループは key: null・「未設定」で末尾', () => {
    const options: SelectOption[] = [
      { value: 'lead', label: '見込み', color: 'blue' },
      { value: 'deal', label: '商談中', color: 'green' },
      { value: 'won', label: '受注', color: 'orange' },
      { value: 'lost', label: '失注', color: 'red' },
    ]
    createObject({
      key: 'deals',
      label: '試しの案件',
      icon: 'box',
      color: 'blue',
      fields: [
        { key: 'name', label: '名前', type: 'text' },
        { key: 'stage', label: '段階', type: 'select', options },
      ],
    })
    // 件数は 見込み 2・商談中 1・受注 4・失注 3・空 5。空のグループがいちばん多く、入れる順も定義順とばらばら
    const stages = ['won', null, 'lost', 'lead', null, 'won', 'deal', null, 'lost', 'won', null, 'lead', 'lost', null, 'won']
    stages.forEach((stage, i) => insert('deals', { name: `D${i}`, stage }, null))
    const rows = (order?: 'value_desc') => aggregate('deals', { group_by: { field: 'stage' }, measure: { op: 'count' }, ...(order ? { order } : {}) }, null)

    // 省略時: 選択肢の定義順。空は末尾に key: null・「未設定」で出る
    expect(rows().map((r) => [r.key, r.label, r.value])).toEqual([
      ['lead', '見込み', 2],
      ['deal', '商談中', 1],
      ['won', '受注', 4],
      ['lost', '失注', 3],
      [null, '未設定', 5],
    ])
    expect(rows().map((r) => r.color)).toEqual(['blue', 'green', 'orange', 'red', undefined])

    // value_desc: 選択肢でも値の大きい順。空のグループは値が最大でも末尾
    expect(rows('value_desc').map((r) => [r.key, r.label, r.value])).toEqual([
      ['won', '受注', 4],
      ['lost', '失注', 3],
      ['lead', '見込み', 2],
      ['deal', '商談中', 1],
      [null, '未設定', 5],
    ])
  })
  it('IO-029 aggregate の bucket: month + range は範囲内の月を全部、空の月も 0 で返し、ラベルは区間の先頭と 1 月だけ年付き', () => {
    // 今日を 2026-10-15(JST の昼)に固定する。range は今日の月を 0 とした相対の月
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T03:00:00Z'))
    try {
      createObject({
        key: 'deals',
        label: '試しの案件',
        icon: 'box',
        color: 'blue',
        fields: [
          { key: 'name', label: '名前', type: 'text' },
          { key: 'close_date', label: '締め日', type: 'date' },
        ],
      })
      // 8 月 2 件・10 月 1 件・2027 年 1 月 3 件。9・11・12・2 月は 0 件。範囲外(7 月・2027 年 3 月)と空の日付は数えない
      const dates = ['2026-08-01', '2026-08-31', '2026-10-15', '2027-01-01', '2027-01-15', '2027-01-31', '2026-07-31', '2027-03-01', null]
      dates.forEach((close_date, i) => insert('deals', { name: `D${i}`, close_date }, null))

      const rows = aggregate('deals', { group_by: { field: 'close_date', bucket: 'month', range: { from: -2, to: 4 } }, measure: { op: 'count' } }, null)
      expect(rows.map((r) => [r.key, r.label, r.value])).toEqual([
        ['2026-08', '2026年8月', 2],
        ['2026-09', '9月', 0],
        ['2026-10', '10月', 1],
        ['2026-11', '11月', 0],
        ['2026-12', '12月', 0],
        ['2027-01', '2027年1月', 3],
        ['2027-02', '2月', 0],
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('IO-030 aggregate を関連先のテーブル名の列(related_object)で分けると、ラベルはテーブルの表示名、空は「関連先なし」', () => {
    // タスクの関連先は取引先・商談などが混ざり、空の行もある
    const all = table('tasks')
    const counts = new Map<string | null, number>()
    for (const r of all) {
      const key = typeof r.related_object === 'string' && r.related_object !== '' ? r.related_object : null
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    expect(counts.has(null)).toBe(true)
    expect([...counts.keys()].filter((k) => k !== null).length).toBeGreaterThanOrEqual(2)

    const labelOf = (key: string) => getMeta().objects.find((o) => o.key === key)!.label
    const rows = aggregate('tasks', { group_by: { field: 'related_object' }, measure: { op: 'count' } }, null)
    // どのグループも、ラベルはテーブルの表示名(列名のままではない)。空は key: null・「関連先なし」で末尾
    const expected = [...counts.entries()]
      .map(([key, value]) => ({ key, label: key === null ? '関連先なし' : labelOf(key), value }))
      .sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : b.value - a.value))
    expect(rows.map((r) => ({ key: r.key, label: r.label, value: r.value }))).toEqual(expected)
    for (const r of rows) if (r.key !== null) expect(r.label).not.toBe(r.key)
    expect(rows.at(-1)).toMatchObject({ key: null, label: '関連先なし' })
  })
})

describe('タスクの追加(mocks/engine.ts の insert)', () => {
  beforeEach(() => resetTables())

  const TAKUYA = '09000000-0000-7000-8000-000000000001'
  const MISAKI = '09000000-0000-7000-8000-000000000002'

  it('TASK-004 優先度を省くと P4、担当は自分、状況は先頭の選択肢(未着手)になる', () => {
    const status = getMeta().objects.find((o) => o.key === 'tasks')!.fields.find((f) => f.key === 'status')!.options!
    expect(status[0]).toMatchObject({ value: 'open', label: '未着手' })

    // 件名だけで作る。担当は呼んだ人(Takuya でも Misaki でも、その人になる)
    for (const me of [TAKUYA, MISAKI]) {
      const { record } = insert('tasks', { title: '見積もりを送る' }, me)
      expect(record, me).toMatchObject({ priority: 'p4', assignee_id: me, status: 'open', completed_at: null })
      // 保存された行も同じ(返り値だけでなく)
      expect(find('tasks', record.id as string)!.record).toMatchObject({ priority: 'p4', assignee_id: me, status: 'open' })
    }

    // 送った値は既定値より勝つ
    const { record } = insert('tasks', { title: '電話する', priority: 'p1', status: 'in_progress', assignee_id: MISAKI }, TAKUYA)
    expect(record).toMatchObject({ priority: 'p1', status: 'in_progress', assignee_id: MISAKI })
  })

  it('TASK-005 件名が空・関連先が片方だけ・targets 外のテーブルは 400 で、行は増えない', () => {
    const accountId = table('accounts')[0].id as string
    const opportunityId = table('opportunities')[0].id as string
    const contactId = table('contacts')[0].id as string
    const before = table('tasks').length
    const bad: [string, Record<string, string | null>][] = [
      // 件名が空(省く・null・空文字)
      ['件名を省く', { priority: 'p2' }],
      ['件名が null', { title: null }],
      ['件名が空文字', { title: '' }],
      // 関連先の片方だけ
      ['テーブル名だけ', { title: '電話する', related_object: 'accounts' }],
      ['ID だけ', { title: '電話する', related_id: accountId }],
      // targets(accounts・opportunities)の外。ID はそのテーブルに実在する
      ['取引先責任者', { title: '電話する', related_object: 'contacts', related_id: contactId }],
      ['タスク', { title: '電話する', related_object: 'tasks', related_id: table('tasks')[0].id as string }],
      ['無いテーブル', { title: '電話する', related_object: 'nothing', related_id: accountId }],
    ]
    for (const [label, values] of bad) {
      expect(statusOf(() => insert('tasks', values, TAKUYA)), label).toBe(400)
    }
    expect(table('tasks').length).toBe(before)

    // 境界: 件名があり、関連先が targets 内のテーブルと ID の組なら通る。関連先なし(両方 null)も通る
    for (const [object, id] of [['accounts', accountId], ['opportunities', opportunityId]]) {
      const { record } = insert('tasks', { title: '電話する', related_object: object, related_id: id }, TAKUYA)
      expect(record).toMatchObject({ title: '電話する', related_object: object, related_id: id })
    }
    expect(statusOf(() => insert('tasks', { title: '電話する' }, TAKUYA))).toBeNull()
    expect(table('tasks').length).toBe(before + 3)
  })
})

describe('タスクの完了(mocks/engine.ts の update)', () => {
  beforeEach(() => resetTables())

  const TAKUYA = '09000000-0000-7000-8000-000000000001'

  it('TASK-023 done にすると completed_at と updated_at が今になり、open に戻すと completed_at は null', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      // 未着手のタスクを作ってから、時計を進めて完了にする(作った時刻と区別できるように)
      vi.setSystemTime(new Date('2026-10-01T00:00:00Z'))
      const { record } = insert('tasks', { title: '見積もりを送る' }, TAKUYA)
      const id = record.id as string
      expect(record).toMatchObject({ status: 'open', completed_at: null })

      const doneAt = '2026-10-02T01:23:45.000Z'
      vi.setSystemTime(new Date(doneAt))
      const done = update('tasks', id, { status: 'done' }, TAKUYA)!.record
      expect(done).toMatchObject({ status: 'done', completed_at: doneAt, updated_at: doneAt })
      // 保存された行も同じ(返り値だけでなく)
      expect(find('tasks', id)!.record).toMatchObject({ completed_at: doneAt, updated_at: doneAt })

      // 戻す: completed_at は消え、updated_at はその時刻になる
      const reopenAt = '2026-10-03T04:56:07.000Z'
      vi.setSystemTime(new Date(reopenAt))
      const reopened = update('tasks', id, { status: 'open' }, TAKUYA)!.record
      expect(reopened).toMatchObject({ status: 'open', completed_at: null, updated_at: reopenAt })
      expect(find('tasks', id)!.record).toMatchObject({ completed_at: null, updated_at: reopenAt })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('タスクの完了日時の持ち込み(mocks/engine.ts の update・insert)', () => {
  beforeEach(() => resetTables())

  const TAKUYA = '09000000-0000-7000-8000-000000000001'

  it('TASK-024 done と一緒に completed_at を渡すと、今ではなく渡した日時が残る(update も insert も)', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const now = '2026-10-05T09:00:00.000Z'
      vi.setSystemTime(new Date(now))
      // 移行で持ち込む元の完了日時(今より前)
      const original = '2024-03-15T02:30:00.000Z'

      // update: 未着手のタスクを、完了日時つきで完了にする
      const { record } = insert('tasks', { title: '請求書を送る' }, TAKUYA)
      const id = record.id as string
      const done = update('tasks', id, { status: 'done', completed_at: original }, TAKUYA)!.record
      expect(done).toMatchObject({ status: 'done', completed_at: original, updated_at: now })
      expect(find('tasks', id)!.record.completed_at).toBe(original)

      // insert: 最初から完了 + 完了日時
      const created = insert('tasks', { title: '契約書を返送する', status: 'done', completed_at: original }, TAKUYA).record
      expect(created).toMatchObject({ status: 'done', completed_at: original })
      expect(find('tasks', created.id as string)!.record.completed_at).toBe(original)

      // 対照: 完了日時を渡さなければ今になる(上の尊重が既定の動きでないことを示す)
      const plain = insert('tasks', { title: '議事録を共有する', status: 'done' }, TAKUYA).record
      expect(plain.completed_at).toBe(now)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('タスクの完了のやり直し(mocks/engine.ts の update)', () => {
  beforeEach(() => resetTables())

  const TAKUYA = '09000000-0000-7000-8000-000000000001'

  it('TASK-025 完了済みのタスクにもう一度 done を送っても、completed_at は最初に完了にした日時のまま', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-01T00:00:00Z'))
      const { record } = insert('tasks', { title: '見積もりを送る' }, TAKUYA)
      const id = record.id as string

      const doneAt = '2026-10-02T01:23:45.000Z'
      vi.setSystemTime(new Date(doneAt))
      expect(update('tasks', id, { status: 'done' }, TAKUYA)!.record.completed_at).toBe(doneAt)

      // 時計を進めてから、同じ done をもう一度送る(二重送信・再試行)
      vi.setSystemTime(new Date('2026-10-04T08:00:00.000Z'))
      const again = update('tasks', id, { status: 'done' }, TAKUYA)!.record
      expect(again).toMatchObject({ status: 'done', completed_at: doneAt })
      expect(find('tasks', id)!.record.completed_at).toBe(doneAt)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('タスクを完了でない状況へ移す(mocks/engine.ts の update)', () => {
  beforeEach(() => resetTables())

  const TAKUYA = '09000000-0000-7000-8000-000000000001'

  it('TASK-026 open → 相手待ちでは completed_at は null のまま、done → 相手待ちでは completed_at が null になる', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-01T00:00:00Z'))

      // open → 相手待ち: 完了日時は付かない
      const open = insert('tasks', { title: '見積もりの返事を待つ' }, TAKUYA).record
      const openId = open.id as string
      expect(open).toMatchObject({ status: 'open', completed_at: null })
      const waiting = update('tasks', openId, { status: 'waiting' }, TAKUYA)!.record
      expect(waiting).toMatchObject({ status: 'waiting', completed_at: null })
      expect(find('tasks', openId)!.record.completed_at).toBeNull()

      // done → 相手待ち: 完了日時は消える
      const { record } = insert('tasks', { title: '契約書を送る' }, TAKUYA)
      const doneId = record.id as string
      const doneAt = '2026-10-02T01:23:45.000Z'
      vi.setSystemTime(new Date(doneAt))
      expect(update('tasks', doneId, { status: 'done' }, TAKUYA)!.record.completed_at).toBe(doneAt)

      vi.setSystemTime(new Date('2026-10-03T04:56:07.000Z'))
      const back = update('tasks', doneId, { status: 'waiting' }, TAKUYA)!.record
      expect(back).toMatchObject({ status: 'waiting', completed_at: null })
      expect(find('tasks', doneId)!.record.completed_at).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('繰り返しのタスクの完了(mocks/engine.ts の update)', () => {
  beforeEach(() => resetTables())

  const TAKUYA = '09000000-0000-7000-8000-000000000001'
  const OTHER = '09000000-0000-7000-8000-000000000002'

  it('TASK-044 repeat=weekly・期限 9/22 を done にすると、その行は done で残り、期限 9/29・open・repeat_of=元の id の次回が 1 つでき、中身が写る', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-09-22T00:00:00Z'))
      const opportunityId = table('opportunities')[0].id as string
      const contactId = table('contacts')[0].id as string
      // 既定値と区別できる値を入れる(担当は自分でない人、優先度は p1)
      const source = {
        title: '週報を書く',
        priority: 'p1',
        due_date: '2026-09-22',
        repeat: 'weekly',
        labels: '["internal","follow_up"]',
        related_object: 'opportunities',
        related_id: opportunityId,
        contact_id: contactId,
        assignee_id: OTHER,
      }
      const { record } = insert('tasks', source, TAKUYA)
      const id = record.id as string
      const before = table('tasks').length

      update('tasks', id, { status: 'done' }, TAKUYA)

      // 元の行は done のまま残る(期限も動かない)
      expect(find('tasks', id)!.record).toMatchObject({ status: 'done', due_date: '2026-09-22', repeat: 'weekly' })
      // 新しい行はちょうど 1 つ
      expect(table('tasks').length).toBe(before + 1)
      const next = table('tasks').filter((r) => r.repeat_of === id)
      expect(next).toHaveLength(1)
      expect(next[0].id).not.toBe(id)
      expect(next[0]).toMatchObject({
        ...source,
        due_date: '2026-09-29',
        status: 'open',
        repeat_of: id,
        completed_at: null,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('繰り返しを完了した日から数える(mocks/engine.ts の update)', () => {
  beforeEach(() => resetTables())

  const TAKUYA = '09000000-0000-7000-8000-000000000001'

  it('TASK-045 repeat_from_completion が真なら、期限が過去(9/1)でも次回は完了した日(9/22)+7 = 9/29 になる。偽なら元の期限 +7 = 9/8', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      // 日本時間でも UTC でも同じ日付になる時刻(9/22 の昼)
      vi.setSystemTime(new Date('2026-09-22T03:00:00Z'))
      const nextDueOf = (fromCompletion: boolean) => {
        const { record } = insert('tasks', {
          title: '週報を書く',
          due_date: '2026-09-01',
          repeat: 'weekly',
          repeat_from_completion: fromCompletion,
        }, TAKUYA)
        const id = record.id as string
        update('tasks', id, { status: 'done' }, TAKUYA)
        const next = table('tasks').filter((r) => r.repeat_of === id)
        expect(next).toHaveLength(1)
        return next[0]
      }

      const fromCompletion = nextDueOf(true)
      expect(fromCompletion).toMatchObject({ due_date: '2026-09-29', status: 'open', repeat_from_completion: true })
      // 比べる相手: 偽なら元の期限から数える
      expect(nextDueOf(false).due_date).toBe('2026-09-08')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('繰り返しの完了を二重に送る(mocks/engine.ts の update)', () => {
  beforeEach(() => resetTables())

  const TAKUYA = '09000000-0000-7000-8000-000000000001'

  it('TASK-046 同じ行に done を 2 回送っても、次回は 1 つだけ(二重に作らない)', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-09-22T03:00:00Z'))
      const { record } = insert('tasks', { title: '週報を書く', due_date: '2026-09-22', repeat: 'weekly' }, TAKUYA)
      const id = record.id as string
      const before = table('tasks').length

      update('tasks', id, { status: 'done' }, TAKUYA)
      const first = table('tasks').filter((r) => r.repeat_of === id)
      expect(first).toHaveLength(1)

      // もう一度 done を送る(再送・二重クリック)
      update('tasks', id, { status: 'done' }, TAKUYA)

      const next = table('tasks').filter((r) => r.repeat_of === id)
      expect(next).toHaveLength(1)
      expect(next[0].id).toBe(first[0].id)
      expect(table('tasks').length).toBe(before + 1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('繰り返しの完了を戻す(mocks/engine.ts の update)', () => {
  beforeEach(() => resetTables())

  const TAKUYA = '09000000-0000-7000-8000-000000000001'

  it('TASK-047 done を open に戻すと未着手の次回は消え、次回を既に完了していれば消さない', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-09-22T03:00:00Z'))

      // 次回がまだ未着手 → 戻すと消える
      const a = insert('tasks', { title: '週報を書く', due_date: '2026-09-22', repeat: 'weekly' }, TAKUYA).record.id as string
      const before = table('tasks').length
      update('tasks', a, { status: 'done' }, TAKUYA)
      expect(table('tasks').filter((r) => r.repeat_of === a)).toHaveLength(1)
      update('tasks', a, { status: 'open' }, TAKUYA)
      expect(table('tasks').filter((r) => r.repeat_of === a)).toHaveLength(0)
      expect(table('tasks').length).toBe(before)
      expect(find('tasks', a)?.record.status).toBe('open')

      // 次回を既に完了している → 戻しても消さない
      const b = insert('tasks', { title: '月次の締め', due_date: '2026-09-22', repeat: 'weekly' }, TAKUYA).record.id as string
      update('tasks', b, { status: 'done' }, TAKUYA)
      const nextId = table('tasks').find((r) => r.repeat_of === b)!.id as string
      update('tasks', nextId, { status: 'done' }, TAKUYA)
      update('tasks', b, { status: 'open' }, TAKUYA)
      const kept = table('tasks').filter((r) => r.repeat_of === b)
      expect(kept).toHaveLength(1)
      expect(kept[0].id).toBe(nextId)
      expect(kept[0].status).toBe('done')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('繰り返しの規則か期限が空のタスクの完了(mocks/engine.ts の update)', () => {
  beforeEach(() => resetTables())

  const TAKUYA = '09000000-0000-7000-8000-000000000001'

  it('TASK-048 repeat があっても期限が空なら次回は作らない。repeat が空でも作らない', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-09-22T03:00:00Z'))
      const cases: Record<string, Scalar>[] = [
        { title: '期限なしの繰り返し', due_date: null, repeat: 'weekly' },
        { title: '期限なしの繰り返し(完了日から)', due_date: null, repeat: 'weekly', repeat_from_completion: true },
        { title: '繰り返しなし', due_date: '2026-09-22', repeat: null },
        { title: '繰り返しが空文字', due_date: '2026-09-22', repeat: '' },
      ]
      for (const values of cases) {
        const id = insert('tasks', values, TAKUYA).record.id as string
        const before = table('tasks').length

        update('tasks', id, { status: 'done' }, TAKUYA)

        const label = String(values.title)
        // 完了そのものは効く
        expect(find('tasks', id)!.record.status, label).toBe('done')
        // 次回は作らない
        expect(table('tasks').filter((r) => r.repeat_of === id), label).toHaveLength(0)
        expect(table('tasks').length, label).toBe(before)
      }

      // 比べる相手: 期限と repeat が両方あれば次回ができる
      const id = insert('tasks', { title: '両方ある', due_date: '2026-09-22', repeat: 'weekly' }, TAKUYA).record.id as string
      update('tasks', id, { status: 'done' }, TAKUYA)
      expect(table('tasks').filter((r) => r.repeat_of === id)).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
