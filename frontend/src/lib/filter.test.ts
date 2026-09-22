import { describe, expect, it } from 'vitest'
import type { Row } from '@/api/types'
import { matchFilter } from './filter'

// テストケース表: docs/tests/io.md。1 つの it が表の 1 行(ID をラベルに入れる)
const ctx = { today: '2026-09-22', me: 'u1' }
const row = (v: Partial<Row>): Row => ({ id: 'r', ...v })

describe('フィルタの評価(lib/filter.ts)', () => {
  it('IO-001 ne は NULL を含む(空も「違う」)', () => {
    expect(matchFilter(row({ status: null }), { field: 'status', op: 'ne', value: 'done' }, ctx)).toBe(true)
    expect(matchFilter(row({ status: 'done' }), { field: 'status', op: 'ne', value: 'done' }, ctx)).toBe(false)
  })
  it('IO-002 eq と大小比較は NULL に対して偽', () => {
    expect(matchFilter(row({ amount: null }), { field: 'amount', op: 'eq', value: 1 }, ctx)).toBe(false)
    expect(matchFilter(row({ amount: null }), { field: 'amount', op: 'gt', value: 1 }, ctx)).toBe(false)
    expect(matchFilter(row({ amount: null }), { field: 'amount', op: 'lte', value: 1 }, ctx)).toBe(false)
  })
  it('IO-003 $today / $today+7 / $start_of_month は今日を基準に解決する', () => {
    expect(matchFilter(row({ due: '2026-09-22' }), { field: 'due', op: 'eq', value: '$today' }, ctx)).toBe(true)
    expect(matchFilter(row({ due: '2026-09-29' }), { field: 'due', op: 'lte', value: '$today+7' }, ctx)).toBe(true)
    expect(matchFilter(row({ due: '2026-09-30' }), { field: 'due', op: 'lte', value: '$today+7' }, ctx)).toBe(false)
    expect(matchFilter(row({ due: '2026-09-01' }), { field: 'due', op: 'eq', value: '$start_of_month' }, ctx)).toBe(true)
  })
})
