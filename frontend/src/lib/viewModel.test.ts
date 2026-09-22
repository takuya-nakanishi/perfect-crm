import { describe, expect, it } from 'vitest'
import type { Condition, FieldMeta, Filter, ObjectMeta, ViewMeta } from '@/api/types'
import { flatten, newViewInput, unflatten } from './viewModel'

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
