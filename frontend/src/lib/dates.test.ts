import { afterEach, describe, expect, it, vi } from 'vitest'
import { addMonths, formatDateTime, formatDue, resolveDateMacro } from './dates'

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

describe('formatDateTime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // 端末の時刻帯で読むので、日時も端末の時刻帯で組み立てる(実行環境の TZ に左右されない)
  const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString()

  it('IO-041 今日は「今日 9:05」、昨日は「昨日 時:分」、同じ年は月日だけ、違う年は 2025/12/01', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 22, 15, 0)) // 2026-09-22 15:00
    // 今日は時刻付き。時は 0 埋めせず、分は 2 桁
    expect(formatDateTime(at(2026, 9, 22, 9, 5))).toBe('今日 9:05')
    expect(formatDateTime(at(2026, 9, 22, 0, 0))).toBe('今日 0:00')
    expect(formatDateTime(at(2026, 9, 22, 23, 59))).toBe('今日 23:59')
    // 昨日も時刻付き
    expect(formatDateTime(at(2026, 9, 21, 18, 30))).toBe('昨日 18:30')
    // 一昨日から先は、同じ年なら月日だけ(時刻は出さない)
    expect(formatDateTime(at(2026, 9, 20, 9, 5))).toBe('9月20日')
    expect(formatDateTime(at(2026, 1, 1, 12, 0))).toBe('1月1日')
    // 違う年は年月日
    expect(formatDateTime(at(2025, 12, 1, 9, 5))).toBe('2025/12/01')
    // 年をまたいでも前日は「昨日」
    vi.setSystemTime(new Date(2027, 0, 1, 10, 0))
    expect(formatDateTime(at(2026, 12, 31, 22, 15))).toBe('昨日 22:15')
    expect(formatDateTime(at(2026, 12, 30, 22, 15))).toBe('2026/12/30')
  })
})

describe('resolveDateMacro', () => {
  it('IO-046 $today+N / $today-N / $start_of_month / $end_of_month を今日から解決し、知らないマクロは null', () => {
    expect(resolveDateMacro('$today', today)).toBe('2026-09-22')
    expect(resolveDateMacro('$today+7', today)).toBe('2026-09-29')
    expect(resolveDateMacro('$today-30', today)).toBe('2026-08-23')
    expect(resolveDateMacro('$today+0', today)).toBe('2026-09-22')
    // 月・年をまたぐ
    expect(resolveDateMacro('$today+10', today)).toBe('2026-10-02')
    expect(resolveDateMacro('$today-1', '2026-01-01')).toBe('2025-12-31')
    expect(resolveDateMacro('$start_of_month', today)).toBe('2026-09-01')
    expect(resolveDateMacro('$end_of_month', today)).toBe('2026-09-30')
    // 月末は月の長さに従う(うるう年の 2 月も)
    expect(resolveDateMacro('$end_of_month', '2026-02-10')).toBe('2026-02-28')
    expect(resolveDateMacro('$end_of_month', '2028-02-10')).toBe('2028-02-29')
    expect(resolveDateMacro('$end_of_month', '2026-12-31')).toBe('2026-12-31')
    // 知らないマクロ・崩れた書き方・ただの値は null(呼び出し側がそのまま値として使う)
    expect(resolveDateMacro('$yesterday', today)).toBeNull()
    expect(resolveDateMacro('$today+', today)).toBeNull()
    expect(resolveDateMacro('$today*2', today)).toBeNull()
    expect(resolveDateMacro('$today+7 ', today)).toBeNull()
    expect(resolveDateMacro('$me', today)).toBeNull()
    expect(resolveDateMacro('2026-09-22', today)).toBeNull()
    expect(resolveDateMacro('', today)).toBeNull()
  })
})

describe('addMonths', () => {
  it('IO-047 addMonths は日を 1 日に固定して月を進める(1/31 + 1 は 2/1、12 月 + 1 は翌年 1 月、負の数は前の月)', () => {
    // 日を保たない(1/31 + 1 は 3/3 にも 2/28 にもならず 2/1)。日を保つのは recurrence の nextDue の側
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01')
    expect(addMonths('2026-09-22', 1)).toBe('2026-10-01')
    expect(addMonths('2026-09-01', 0)).toBe('2026-09-01')
    expect(addMonths('2026-09-22', 0)).toBe('2026-09-01')
    // 年をまたぐ
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01')
    expect(addMonths('2026-11-30', 14)).toBe('2028-01-01')
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-01')
  })
})
