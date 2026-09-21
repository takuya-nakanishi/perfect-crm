import { addDays, addMonths, parseISODate, startOfMonth, todayISO, toISODate } from './dates'

/**
 * タスク追加欄の 1 行から、期限と優先度を読み取る(Todoist の書き方に寄せる)。
 *   「見積を送る 明日 p1」→ 件名「見積を送る」・期限は明日・優先度 P1
 * 読み取るのは空白で区切られた単語だけ。「今日の議事録を送る」の「今日」は件名の一部として残す。
 */
export interface ParsedQuickAdd {
  title: string
  due_date: string | null
  priority: string | null
  /** 読み取った単語(画面で「こう解釈した」と見せるため) */
  tokens: { text: string; kind: 'due' | 'priority' }[]
}

const WEEKDAYS = '日月火水木金土'

function nextWeekday(today: string, weekday: number, weeksAhead: number): string {
  const current = parseISODate(today).getDay()
  if (weeksAhead > 0) {
    // 「来週火曜」= 次の月曜から始まる週の火曜
    const toMonday = ((8 - current) % 7 || 7) + (weeksAhead - 1) * 7
    return addDays(today, toMonday + ((weekday + 6) % 7))
  }
  return addDays(today, (weekday - current + 7) % 7 || 7)
}

function parseDateWord(word: string, today: string): string | null {
  const w = word.normalize('NFKC')
  if (w === '今日' || w === 'きょう') return today
  if (w === '明日' || w === 'あした' || w === 'あす') return addDays(today, 1)
  if (w === '明後日' || w === 'あさって') return addDays(today, 2)
  if (w === '来週') return nextWeekday(today, 1, 1)
  if (w === '週末' || w === '今週末') return nextWeekday(today, 6, 0)
  if (w === '月末' || w === '今月末') return addDays(addMonths(startOfMonth(today), 1), -1)
  if (w === '来月') return addMonths(startOfMonth(today), 1)

  let m = /^(来週)?([日月火水木金土])曜?日?$/.exec(w)
  if (m && (m[1] || w.length >= 2)) return nextWeekday(today, WEEKDAYS.indexOf(m[2]), m[1] ? 1 : 0)

  m = /^(\d+)日後$/.exec(w)
  if (m) return addDays(today, Number(m[1]))

  m = /^(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})$/.exec(w) ?? /^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日$/.exec(w)
  if (m) {
    const base = parseISODate(today)
    const month = Number(m[2])
    const day = Number(m[3])
    let year = m[1] ? Number(m[1]) : base.getFullYear()
    const candidate = new Date(year, month - 1, day)
    if (candidate.getMonth() !== month - 1) return null
    // 年を省いて過去の日付になるなら、来年のこと
    if (!m[1] && toISODate(candidate) < today) year++
    return toISODate(new Date(year, month - 1, day))
  }

  m = /^(\d{1,2})日$/.exec(w)
  if (m) {
    const base = parseISODate(today)
    const day = Number(m[1])
    let candidate = new Date(base.getFullYear(), base.getMonth(), day)
    if (toISODate(candidate) < today) candidate = new Date(base.getFullYear(), base.getMonth() + 1, day)
    return candidate.getDate() === day ? toISODate(candidate) : null
  }
  return null
}

export function parseQuickAdd(input: string, today = todayISO()): ParsedQuickAdd {
  const out: ParsedQuickAdd = { title: '', due_date: null, priority: null, tokens: [] }
  const rest: string[] = []
  for (const word of input.split(/[\s　]+/).filter(Boolean)) {
    const priority = /^[pPｐＰ]([1-4１-４])$/.exec(word)
    if (priority && !out.priority) {
      out.priority = `p${priority[1].normalize('NFKC')}`
      out.tokens.push({ text: word, kind: 'priority' })
      continue
    }
    const due = out.due_date ? null : parseDateWord(word, today)
    if (due) {
      out.due_date = due
      out.tokens.push({ text: word, kind: 'due' })
      continue
    }
    rest.push(word)
  }
  out.title = rest.join(' ')
  return out
}
