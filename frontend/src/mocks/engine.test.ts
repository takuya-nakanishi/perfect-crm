import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import type { ObjectInput, SelectOption, TagColor, ViewInput } from '@/api/types'
import { createObject, createView, deleteObject, getMeta, reorderObjects, resetTables, updateObject, updateView } from './engine'

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
})
