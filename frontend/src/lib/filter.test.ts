import { describe, expect, it } from 'vitest'
import type { Condition, Row } from '@/api/types'
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
    // NULL 同士も等しくない(SQL と同じ)。値を省いた eq も偽
    expect(matchFilter(row({ amount: null }), { field: 'amount', op: 'eq', value: null }, ctx)).toBe(false)
    expect(matchFilter(row({ amount: null }), { field: 'amount', op: 'eq' }, ctx)).toBe(false)
    expect(matchFilter(row({ amount: 1 }), { field: 'amount', op: 'ne', value: null }, ctx)).toBe(true)
    expect(matchFilter(row({ amount: null }), { field: 'amount', op: 'gt', value: 1 }, ctx)).toBe(false)
    expect(matchFilter(row({ amount: null }), { field: 'amount', op: 'lte', value: 1 }, ctx)).toBe(false)
  })
  it('IO-003 $today / $today+7 / $start_of_month は今日を基準に解決する', () => {
    expect(matchFilter(row({ due: '2026-09-22' }), { field: 'due', op: 'eq', value: '$today' }, ctx)).toBe(true)
    expect(matchFilter(row({ due: '2026-09-29' }), { field: 'due', op: 'lte', value: '$today+7' }, ctx)).toBe(true)
    expect(matchFilter(row({ due: '2026-09-30' }), { field: 'due', op: 'lte', value: '$today+7' }, ctx)).toBe(false)
    expect(matchFilter(row({ due: '2026-09-01' }), { field: 'due', op: 'eq', value: '$start_of_month' }, ctx)).toBe(true)
  })
  it('IO-004 in は配列のどれかと一致、not_in はどれとも一致しない(NULL は not_in で真)', () => {
    const inList: Condition = { field: 'stage', op: 'in', value: ['won', 'lost'] }
    const notIn: Condition = { field: 'stage', op: 'not_in', value: ['won', 'lost'] }
    expect(matchFilter(row({ stage: 'won' }), inList, ctx)).toBe(true)
    expect(matchFilter(row({ stage: 'lost' }), inList, ctx)).toBe(true)
    expect(matchFilter(row({ stage: 'open' }), inList, ctx)).toBe(false)
    expect(matchFilter(row({ stage: null }), inList, ctx)).toBe(false)
    expect(matchFilter(row({ stage: 'won' }), notIn, ctx)).toBe(false)
    expect(matchFilter(row({ stage: 'open' }), notIn, ctx)).toBe(true)
    // NULL はどれとも一致しないので not_in は真(列が無いときも同じ)
    expect(matchFilter(row({ stage: null }), notIn, ctx)).toBe(true)
    expect(matchFilter(row({}), notIn, ctx)).toBe(true)
  })
  it('IO-005 contains は大文字小文字を区別しない。文字でない列には偽', () => {
    const has = (value: string): Condition => ({ field: 'name', op: 'contains', value })
    expect(matchFilter(row({ name: 'Acme Holdings' }), has('acme'), ctx)).toBe(true)
    expect(matchFilter(row({ name: 'acme holdings' }), has('HOLD'), ctx)).toBe(true)
    expect(matchFilter(row({ name: 'Acme Holdings' }), has('globex'), ctx)).toBe(false)
    // 文字でない列(数値・真偽・NULL)は、文字に直して比べず偽
    expect(matchFilter(row({ name: 123 }), has('12'), ctx)).toBe(false)
    expect(matchFilter(row({ name: true }), has('true'), ctx)).toBe(false)
    expect(matchFilter(row({ name: null }), has(''), ctx)).toBe(false)
    expect(matchFilter(row({}), has('a'), ctx)).toBe(false)
  })
  it('IO-006 is_empty は NULL・空文字・[](複数選択の空)で真、is_not_empty はその逆', () => {
    const empty: Condition = { field: 'tags', op: 'is_empty' }
    const notEmpty: Condition = { field: 'tags', op: 'is_not_empty' }
    // 空と見なす値: NULL・列が無い行・空文字・空の配列(複数選択)
    for (const v of [row({ tags: null }), row({}), row({ tags: '' }), row({ tags: '[]' })]) {
      expect(matchFilter(v, empty, ctx)).toBe(true)
      expect(matchFilter(v, notEmpty, ctx)).toBe(false)
    }
    // 空でない値: 文字・中身のある配列・0・false(0 と偽は空ではない)
    for (const v of [row({ tags: 'a' }), row({ tags: '["vip"]' }), row({ tags: 0 }), row({ tags: false })]) {
      expect(matchFilter(v, empty, ctx)).toBe(false)
      expect(matchFilter(v, notEmpty, ctx)).toBe(true)
    }
  })
})
