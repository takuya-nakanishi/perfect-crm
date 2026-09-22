import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from './quickAddParser'

// テストケース表: docs/tests/io.md。1 つの it が表の 1 行(ID をラベルに入れる)
const today = '2026-09-22' // 火曜日

describe('parseQuickAdd', () => {
  it('IO-042 「見積を送る 明日 p1」は件名・期限・優先度に分かれ、「今日の議事録を送る」の「今日」は件名に残る', () => {
    const parsed = parseQuickAdd('見積を送る 明日 p1', today)
    expect(parsed.title).toBe('見積を送る')
    expect(parsed.due_date).toBe('2026-09-23')
    expect(parsed.priority).toBe('p1')
    expect(parsed.repeat).toBeNull()
    expect(parsed.tokens).toEqual([
      { text: '明日', kind: 'due' },
      { text: 'p1', kind: 'priority' },
    ])

    // 空白で区切られた単語だけを読む。語の一部の「今日」は期限にしない
    const inTitle = parseQuickAdd('今日の議事録を送る', today)
    expect(inTitle.title).toBe('今日の議事録を送る')
    expect(inTitle.due_date).toBeNull()
    expect(inTitle.priority).toBeNull()
    expect(inTitle.tokens).toEqual([])

    // 月末をまたいでも明日は翌日
    expect(parseQuickAdd('見積を送る 明日 p1', '2026-09-30').due_date).toBe('2026-10-01')
  })

  it('IO-043 「来週火曜」「金曜」「月末」「来月」「3日後」「9/30」「30日」を今日から見た日付に直す', () => {
    const due = (word: string, on = today) => parseQuickAdd(`見積を送る ${word}`, on).due_date

    // 来週火曜 = 次の月曜(9/28)から始まる週の火曜。今日が月曜でも日曜でも同じ週を指す
    expect(due('来週火曜')).toBe('2026-09-29')
    expect(due('来週火曜', '2026-09-21')).toBe('2026-09-29') // 月曜
    expect(due('来週火曜', '2026-09-27')).toBe('2026-09-29') // 日曜

    // 金曜 = 次の金曜。今日が金曜なら 7 日後
    expect(due('金曜')).toBe('2026-09-25')
    expect(due('金曜', '2026-09-25')).toBe('2026-10-02')

    // 月末は今月の最終日、来月は来月の 1 日
    expect(due('月末')).toBe('2026-09-30')
    expect(due('来月')).toBe('2026-10-01')
    expect(due('3日後')).toBe('2026-09-25')
    expect(due('9/30')).toBe('2026-09-30')

    // 30日 = 今月の 30 日。過ぎていれば来月
    expect(due('30日')).toBe('2026-09-30')
    expect(due('20日')).toBe('2026-10-20')

    // 日付の単語は件名から外れる
    expect(parseQuickAdd('見積を送る 来週火曜', today).title).toBe('見積を送る')
  })

  it('IO-044 「毎週」は repeat: weekly、期限が無ければ今日。「平日」「隔週」「毎月」も読み、2 つめの繰り返しの語は件名に残る', () => {
    const weekly = parseQuickAdd('週報を書く 毎週', today)
    expect(weekly.title).toBe('週報を書く')
    expect(weekly.repeat).toBe('weekly')
    // 期限を書かなければ、最初の回は今日
    expect(weekly.due_date).toBe(today)
    expect(weekly.tokens).toEqual([{ text: '毎週', kind: 'repeat' }])

    expect(parseQuickAdd('日報を書く 平日', today).repeat).toBe('weekdays')
    expect(parseQuickAdd('定例に出る 隔週', today).repeat).toBe('biweekly')
    expect(parseQuickAdd('請求書を送る 毎月', today).repeat).toBe('monthly')

    // 期限を書けば、そちらが最初の回
    expect(parseQuickAdd('定例に出る 隔週 金曜', today).due_date).toBe('2026-09-25')

    // 読む繰り返しは 1 つだけ。2 つめの語は件名に残る
    const twice = parseQuickAdd('毎週 毎月の振り返り 毎月', today)
    expect(twice.repeat).toBe('weekly')
    expect(twice.title).toBe('毎月の振り返り 毎月')
    expect(twice.tokens).toEqual([{ text: '毎週', kind: 'repeat' }])
  })

  it('IO-045 全角の「ｐ１」「９／３０」も読む(NFKC)', () => {
    const parsed = parseQuickAdd('見積を送る ９／３０ ｐ１', today)
    expect(parsed.title).toBe('見積を送る')
    expect(parsed.due_date).toBe('2026-09-30')
    expect(parsed.priority).toBe('p1')
    // 読み取った単語は打ったままの字で見せる
    expect(parsed.tokens).toEqual([
      { text: '９／３０', kind: 'due' },
      { text: 'ｐ１', kind: 'priority' },
    ])

    // 大文字の全角、全角の空白での区切り、全角数字の日付・日数も同じに読む
    const upper = parseQuickAdd('見積を送る　Ｐ２　３日後', today)
    expect(upper.title).toBe('見積を送る')
    expect(upper.priority).toBe('p2')
    expect(upper.due_date).toBe('2026-09-25')
    expect(parseQuickAdd('見積を送る １０月１日', today).due_date).toBe('2026-10-01')
  })
})
