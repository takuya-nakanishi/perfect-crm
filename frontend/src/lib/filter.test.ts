import { describe, expect, it, vi } from 'vitest'
import type { Condition, Filter, Row } from '@/api/types'
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
  it('IO-007 日時の列を日付と比べるときは、文脈の時刻帯(ctx.timezone)での日付に直してから比べる', () => {
    // UTC 23:30 の完了。Asia/Tokyo では翌日の 08:30、UTC では当日
    const done = row({ completed_at: '2026-09-22T23:30:00.000Z' })
    const on = (value: string): Condition => ({ field: 'completed_at', op: 'eq', value })
    const tokyo = { ...ctx, timezone: 'Asia/Tokyo' }
    const utc = { ...ctx, timezone: 'UTC' }
    expect(matchFilter(done, on('2026-09-23'), tokyo)).toBe(true)
    expect(matchFilter(done, on('2026-09-22'), tokyo)).toBe(false)
    expect(matchFilter(done, on('2026-09-22'), utc)).toBe(true)
    expect(matchFilter(done, on('2026-09-23'), utc)).toBe(false)
    // 大小比較も日付に直してから。マクロ($today)も同じく日付として比べる
    expect(matchFilter(done, { field: 'completed_at', op: 'gt', value: '$today' }, tokyo)).toBe(true)
    expect(matchFilter(done, { field: 'completed_at', op: 'lte', value: '$today' }, utc)).toBe(true)
    // 時刻帯が文脈で決まるので、端末の時刻帯(TZ)を変えても結果は同じ
    try {
      for (const tz of ['America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
        vi.stubEnv('TZ', tz)
        expect(matchFilter(done, on('2026-09-23'), tokyo)).toBe(true)
        expect(matchFilter(done, on('2026-09-22'), utc)).toBe(true)
      }
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('IO-008 $me は文脈の利用者 ID、$today-30 は 30 日前、$end_of_month は月末に解決する', () => {
    // $me: 文脈の利用者(u1)に解決する。利用者が無い文脈では誰とも一致しない
    const mine: Condition = { field: 'owner_id', op: 'eq', value: '$me' }
    expect(matchFilter(row({ owner_id: 'u1' }), mine, ctx)).toBe(true)
    expect(matchFilter(row({ owner_id: 'u2' }), mine, ctx)).toBe(false)
    expect(matchFilter(row({ owner_id: '$me' }), mine, { ...ctx, me: null })).toBe(false)
    expect(matchFilter(row({ owner_id: null }), mine, { ...ctx, me: null })).toBe(false)
    expect(matchFilter(row({ owner_id: 'u2' }), { field: 'owner_id', op: 'in', value: ['$me'] }, { ...ctx, me: 'u2' })).toBe(true)
    // $today-30: 2026-09-22 の 30 日前は月をまたいで 2026-08-23
    const ago = (op: Condition['op']): Condition => ({ field: 'due', op, value: '$today-30' })
    expect(matchFilter(row({ due: '2026-08-23' }), ago('eq'), ctx)).toBe(true)
    expect(matchFilter(row({ due: '2026-08-22' }), ago('lt'), ctx)).toBe(true)
    expect(matchFilter(row({ due: '2026-08-24' }), ago('lt'), ctx)).toBe(false)
    // $end_of_month: 今日の月の末日。30 日の月・閏年の 2 月・年末
    const eom: Condition = { field: 'due', op: 'eq', value: '$end_of_month' }
    expect(matchFilter(row({ due: '2026-09-30' }), eom, ctx)).toBe(true)
    expect(matchFilter(row({ due: '2026-09-31' }), eom, ctx)).toBe(false)
    expect(matchFilter(row({ due: '2028-02-29' }), eom, { ...ctx, today: '2028-02-10' })).toBe(true)
    expect(matchFilter(row({ due: '2026-12-31' }), eom, { ...ctx, today: '2026-12-01' })).toBe(true)
  })
  it('IO-009 複数選択(JSON の配列)は in / eq が「どれかを含む」、not_in / ne が「どれも含まない」。壊れた JSON は配列と見なさない', () => {
    const tagged = row({ tags: '["vip","hot"]' })
    const cond = (op: Condition['op'], value: Condition['value']): Condition => ({ field: 'tags', op, value })
    // in / eq: 選んだ値のどれかを含めば真
    expect(matchFilter(tagged, cond('in', ['hot', 'cold']), ctx)).toBe(true)
    expect(matchFilter(tagged, cond('in', ['cold', 'new']), ctx)).toBe(false)
    expect(matchFilter(tagged, cond('eq', 'vip'), ctx)).toBe(true)
    expect(matchFilter(tagged, cond('eq', 'cold'), ctx)).toBe(false)
    // not_in / ne: どれも含まなければ真。1 つでも含めば偽
    expect(matchFilter(tagged, cond('not_in', ['cold', 'new']), ctx)).toBe(true)
    expect(matchFilter(tagged, cond('not_in', ['cold', 'vip']), ctx)).toBe(false)
    expect(matchFilter(tagged, cond('ne', 'cold'), ctx)).toBe(true)
    expect(matchFilter(tagged, cond('ne', 'hot'), ctx)).toBe(false)
    // 空の配列は何も含まない
    expect(matchFilter(row({ tags: '[]' }), cond('in', ['vip']), ctx)).toBe(false)
    expect(matchFilter(row({ tags: '[]' }), cond('not_in', ['vip']), ctx)).toBe(true)
    // 壊れた JSON は配列と見なさず、ただの文字として比べる(中の値を含むとは扱わない)
    const broken = row({ tags: '["vip","hot"' })
    expect(matchFilter(broken, cond('in', ['vip']), ctx)).toBe(false)
    expect(matchFilter(broken, cond('eq', 'vip'), ctx)).toBe(false)
    expect(matchFilter(broken, cond('not_in', ['vip']), ctx)).toBe(true)
    expect(matchFilter(broken, cond('ne', 'vip'), ctx)).toBe(true)
    expect(matchFilter(broken, cond('eq', '["vip","hot"'), ctx)).toBe(true)
  })
  it('IO-010 and の中の or(お気に入りの「今日」: 期限が今日以前 または 期限が空)を正しく評価する。空の and は真', () => {
    const todayView: Filter = {
      and: [
        { field: 'done', op: 'eq', value: false },
        { or: [{ field: 'due', op: 'lte', value: '$today' }, { field: 'due', op: 'is_empty' }] },
      ],
    }
    // or のどちらかに当たり、and の残りも満たせば真
    expect(matchFilter(row({ done: false, due: '2026-09-22' }), todayView, ctx)).toBe(true)
    expect(matchFilter(row({ done: false, due: '2026-09-01' }), todayView, ctx)).toBe(true)
    expect(matchFilter(row({ done: false, due: null }), todayView, ctx)).toBe(true)
    // or のどちらにも当たらなければ偽(明日の期限)
    expect(matchFilter(row({ done: false, due: '2026-09-23' }), todayView, ctx)).toBe(false)
    // or に当たっても、and の残りを満たさなければ偽
    expect(matchFilter(row({ done: true, due: '2026-09-22' }), todayView, ctx)).toBe(false)
    expect(matchFilter(row({ done: true, due: null }), todayView, ctx)).toBe(false)
    // 空の and は真(条件なし)。空の or は偽
    expect(matchFilter(row({ due: '2026-09-23' }), { and: [] }, ctx)).toBe(true)
    expect(matchFilter(row({ due: '2026-09-23' }), { or: [] }, ctx)).toBe(false)
  })
})
