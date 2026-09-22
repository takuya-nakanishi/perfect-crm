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
})
