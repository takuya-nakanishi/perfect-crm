import { describe, expect, it } from 'vitest'
import type { Condition, Filter } from '@/api/types'
import { flatten, unflatten } from './viewModel'

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
