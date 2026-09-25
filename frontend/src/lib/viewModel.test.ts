import { describe, expect, it } from 'vitest'
import type { Condition, FieldMeta, Filter, MetaResponse, ObjectMeta, ViewMeta } from '@/api/types'
import { describe as describeCondition, flatten, newViewInput, unflatten, uniqueName } from './viewModel'

// テストケース表: docs/tests/meta.md。1 つの it が表の 1 行(ID をラベルに入れる)
const a: Condition = { field: 'status', op: 'eq', value: 'open' }
const b: Condition = { field: 'amount', op: 'gte', value: 100 }
const c: Condition = { field: 'due', op: 'lte', value: '$today' }
const nested: Filter = { or: [{ field: 'owner', op: 'eq', value: '$me' }, { field: 'owner', op: 'is_empty' }] }

describe('ビューのフィルタの 1 段化(lib/viewModel.ts)', () => {
  it('META-055 flatten / unflatten は 1 段・単体・入れ子を正規化し、往復で条件の集合と高度な条件と join を保つ', () => {
    // 1 段の and → 条件の配列
    expect(flatten({ and: [a, b] })).toEqual({ join: 'and', conditions: [a, b], advanced: [] })
    expect(flatten({ or: [a, b] })).toEqual({ join: 'or', conditions: [a, b], advanced: [] })
    // 1 条件だけの and → 単体の条件(書き戻すと包みが取れる)
    expect(flatten({ and: [a] })).toEqual({ join: 'and', conditions: [a], advanced: [] })
    expect(unflatten(flatten({ and: [a] }))).toEqual(a)
    expect(flatten(a)).toEqual({ join: 'and', conditions: [a], advanced: [] })
    // 無し・空 → 条件なし
    expect(flatten(undefined)).toEqual({ join: 'and', conditions: [], advanced: [] })
    expect(unflatten({ join: 'or', conditions: [], advanced: [] })).toBeUndefined()
    // 入れ子(and の中の or)→ advanced にそのまま保つ
    const flat = flatten({ and: [a, nested, b] })
    expect(flat).toEqual({ join: 'and', conditions: [a, b], advanced: [nested] })
    expect(flat.advanced[0]).toBe(nested)

    // 往復: 条件の集合・高度な条件の中身・join が保たれる(並びは 条件 → 高度な条件 に正規化される)
    const sets = (f: Filter | undefined) => {
      const x = flatten(f)
      return { join: x.join, conditions: x.conditions.map((v) => JSON.stringify(v)).sort(), advanced: x.advanced }
    }
    const cases: Filter[] = [{ and: [a, nested, b] }, { or: [nested, c, a] }, { and: [nested, { and: [b, c] }] }]
    for (const f of cases) {
      const back = unflatten(flatten(f))
      expect(sets(back)).toEqual(sets(f))
      // 2 回目の往復で形が変わらない(正規形に落ち着く)
      expect(unflatten(flatten(back))).toEqual(back)
    }
    expect(unflatten(flatten({ and: [a, nested, b] }))).toEqual({ and: [a, b, nested] })
    expect(unflatten(flatten({ or: [nested, c] }))).toEqual({ or: [c, nested] })
  })
})

// META-056 の土台: 選択肢の項目を持たないテーブル。表示名は先頭ではなく、readonly と複数行の文字の後ろに置く
const field = (key: string, type: FieldMeta['type'], extra: Partial<FieldMeta> = {}): FieldMeta => ({ key, label: key, type, ...extra })
const plain: ObjectMeta = {
  key: 'things',
  label: 'もの',
  icon: 'box',
  color: 'gray',
  name_field: 'name',
  position: 0,
  in_sidebar: true,
  fields: [
    field('id', 'text', { readonly: true }),
    field('memo', 'textarea'),
    field('body', 'richtext'),
    field('name', 'text'),
    field('created_at', 'datetime', { readonly: true }),
    field('email', 'email'),
    field('phone', 'phone'),
    field('notes', 'textarea'),
    field('amount', 'currency'),
    field('due', 'date'),
    field('owner', 'user'),
    field('site', 'url'),
    field('count', 'number'),
  ],
}

describe('新しいビューの初期値(lib/viewModel.ts newViewInput)', () => {
  it('META-056 選択肢の無いテーブルでカンバンは null、base 無しの一覧は候補の先頭 6 項目、base が一覧なら base の列を写す', () => {
    // 選択肢の無いテーブルでカンバン → null(base があっても、それがカンバンでなければ同じ)
    expect(newViewInput(plain, 'kanban', 'ボード')).toBeNull()

    // base 無しの一覧: readonly と複数行の文字を除いた候補の先頭 6 項目。表示名を含み、幅は型ごとの既定
    const list = newViewInput(plain, 'list', '一覧')
    expect(list).toEqual({
      name: '一覧',
      type: 'list',
      config: {
        columns: [
          { field: 'name', width: 280 },
          { field: 'email', width: 220 },
          { field: 'phone', width: 150 },
          { field: 'amount', width: 140 },
          { field: 'due', width: 120 },
          { field: 'owner', width: 130 },
        ],
      },
    })

    // base が一覧なら、base の列をそのまま写す(候補に無い列・readonly の列・幅の無い列も含めて)。フィルタと並びも受け継ぐ
    const baseColumns = [{ field: 'created_at', width: 99 }, { field: 'memo' }, { field: 'count', width: 77 }]
    const filter: Filter = { field: 'amount', op: 'gte', value: 100 }
    const base: ViewMeta = { id: 'v1', object: 'things', name: '元', position: 0, type: 'list', config: { columns: baseColumns, filter, sort: [{ field: 'due', dir: 'asc' }] } }
    const copied = newViewInput(plain, 'list', '写し', base)
    expect(copied).toEqual({ name: '写し', type: 'list', config: { columns: baseColumns, filter, sort: [{ field: 'due', dir: 'asc' }] } })
    expect(newViewInput(plain, 'kanban', 'ボード', base)).toBeNull()
  })
})

describe('タブの名前の既定(lib/viewModel.ts uniqueName)', () => {
  const view = (name: string, position: number): ViewMeta => ({ id: `v${position}`, object: 'things', name, position, type: 'list', config: { columns: [] } })

  it('META-057 uniqueName は「一覧」があれば「一覧 2」、「一覧 2」もあれば「一覧 3」を返す', () => {
    // 同じ名前が無ければそのまま
    expect(uniqueName('一覧', [])).toBe('一覧')
    expect(uniqueName('一覧', [view('カンバン', 0)])).toBe('一覧')
    // 「一覧」があれば「一覧 2」(番号は 2 から、半角スペースで区切る)
    expect(uniqueName('一覧', [view('一覧', 0)])).toBe('一覧 2')
    // 「一覧 2」もあれば「一覧 3」
    expect(uniqueName('一覧', [view('一覧', 0), view('一覧 2', 1)])).toBe('一覧 3')
    // 空いている番号のうち最も小さいものを使う(「一覧 3」だけがあるなら「一覧 2」)
    expect(uniqueName('一覧', [view('一覧', 0), view('一覧 3', 1)])).toBe('一覧 2')
  })
})

describe('フィルタのチップの言い方(lib/viewModel.ts describe)', () => {
  const meta: MetaResponse = {
    workspace: { id: 'w1', name: '架空の会社', timezone: 'Asia/Tokyo' },
    objects: [],
    folders: [],
    views: [],
    users: [
      { id: 'u1', name: '山田 太郎', email: 'yamada@example.com', avatar_color: 'blue' },
      { id: 'u2', name: '佐藤 花子', email: 'sato@example.com', avatar_color: 'green' },
    ],
  }
  const industry = field('industry', 'select', {
    options: [
      { value: 'medical', label: '医療・福祉', color: 'green' },
      { value: 'retail', label: '小売', color: 'blue' },
    ],
  })

  it('META-058 describe は選択肢をラベル、利用者を名前($me は「自分」)、金額を ¥5,000,000、日付のマクロを「7 日後」で見せる', () => {
    // 選択肢は値ではなくラベル。複数は「, 」で並べる
    expect(describeCondition(meta, industry, { field: 'industry', op: 'eq', value: 'medical' })).toEqual({ op: 'が', value: '医療・福祉' })
    expect(describeCondition(meta, industry, { field: 'industry', op: 'in', value: ['medical', 'retail'] })).toEqual({ op: 'のどれか', value: '医療・福祉, 小売' })

    // 利用者は ID ではなく名前。$me は「自分」
    const owner = field('owner', 'user')
    expect(describeCondition(meta, owner, { field: 'owner', op: 'eq', value: 'u1' })).toEqual({ op: 'が', value: '山田 太郎' })
    expect(describeCondition(meta, owner, { field: 'owner', op: 'eq', value: '$me' })).toEqual({ op: 'が', value: '自分' })
    expect(describeCondition(meta, owner, { field: 'owner', op: 'in', value: ['$me', 'u2'] })).toEqual({ op: 'のどれか', value: '自分, 佐藤 花子' })

    // 金額は円記号と桁区切り。演算子は数値の言い方
    const amount = field('amount', 'currency')
    expect(describeCondition(meta, amount, { field: 'amount', op: 'gte', value: 5000000 })).toEqual({ op: '以上', value: '¥5,000,000' })

    // 日付のマクロは言葉、日付そのものは / 区切り
    const due = field('due', 'date')
    expect(describeCondition(meta, due, { field: 'due', op: 'lte', value: '$today+7' })).toEqual({ op: '以前', value: '7 日後' })
    expect(describeCondition(meta, due, { field: 'due', op: 'lte', value: '2026-09-22' })).toEqual({ op: '以前', value: '2026/09/22' })
  })
})
