import { describe, expect, it } from 'vitest'
import { formatDue } from './dates'

// テストケース表: docs/tests/io.md。1 つの it が表の 1 行(ID をラベルに入れる)
const today = '2026-09-22' // 火曜日

describe('formatDue', () => {
  it('IO-040 今日 / 明日 / 昨日、6 日以内は曜日、それ以外は月日と曜日、年が違えば年付き', () => {
    expect(formatDue('2026-09-22', today)).toBe('今日')
    expect(formatDue('2026-09-23', today)).toBe('明日')
    expect(formatDue('2026-09-21', today)).toBe('昨日')
    // 2〜6 日先は曜日だけ
    expect(formatDue('2026-09-24', today)).toBe('木曜日')
    expect(formatDue('2026-09-25', today)).toBe('金曜日')
    expect(formatDue('2026-09-28', today)).toBe('月曜日')
    // 7 日先からは月日。同じ曜日の来週を「火曜日」と言わない
    expect(formatDue('2026-09-29', today)).toBe('9月29日(火)')
    expect(formatDue('2026-09-30', today)).toBe('9月30日(水)')
    // 2 日以上前は曜日にしない
    expect(formatDue('2026-09-20', today)).toBe('9月20日(日)')
    // 年が違えば年を付ける(先も前も)
    expect(formatDue('2027-01-10', today)).toBe('2027年1月10日(日)')
    expect(formatDue('2025-12-31', today)).toBe('2025年12月31日(水)')
    // 年をまたいでも近い日は言葉で
    expect(formatDue('2027-01-01', '2026-12-31')).toBe('明日')
  })
})
