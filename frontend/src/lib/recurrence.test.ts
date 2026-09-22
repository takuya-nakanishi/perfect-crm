import { describe, expect, it } from 'vitest'
import { nextDue } from './recurrence'

// テストケース表: docs/tests/io.md。1 つの it が表の 1 行(ID をラベルに入れる)
describe('繰り返しの次回の期限(lib/recurrence.ts)', () => {
  it('IO-085 nextDue: 毎日 +1、平日は土日を飛ばす、毎週 +7、隔週 +14、毎月・毎年は日を保つ(無ければ月末)、知らない規則は null', () => {
    expect(nextDue('2026-09-22', 'daily')).toBe('2026-09-23')
    expect(nextDue('2026-12-31', 'daily')).toBe('2027-01-01')
    // 金曜 → 月曜、土曜・日曜 → 月曜、木曜 → 金曜
    expect(nextDue('2026-09-25', 'weekdays')).toBe('2026-09-28')
    expect(nextDue('2026-09-26', 'weekdays')).toBe('2026-09-28')
    expect(nextDue('2026-09-27', 'weekdays')).toBe('2026-09-28')
    expect(nextDue('2026-09-24', 'weekdays')).toBe('2026-09-25')
    expect(nextDue('2026-09-22', 'weekly')).toBe('2026-09-29')
    expect(nextDue('2026-09-22', 'biweekly')).toBe('2026-10-06')
    expect(nextDue('2026-03-15', 'monthly')).toBe('2026-04-15')
    expect(nextDue('2026-01-31', 'monthly')).toBe('2026-02-28')
    expect(nextDue('2024-01-31', 'monthly')).toBe('2024-02-29')
    expect(nextDue('2026-12-15', 'monthly')).toBe('2027-01-15')
    expect(nextDue('2024-02-29', 'yearly')).toBe('2025-02-28')
    expect(nextDue('2026-03-15', 'yearly')).toBe('2027-03-15')
    expect(nextDue('2026-09-22', 'hourly')).toBeNull()
    expect(nextDue('2026-09-22', '')).toBeNull()
  })
})
