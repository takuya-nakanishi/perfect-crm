import { addDays, parseISODate, toISODate } from './dates'

/** 日を保ったまま n か月進める。翌月にその日が無ければ月末(1/31 → 2/28)。dates.addMonths は月の初めへ移す区間用なので使わない */
function addMonthsKeepDay(iso: string, n: number): string {
  const d = parseISODate(iso)
  const day = d.getDate()
  const next = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(day, last))
  return toISODate(next)
}

/**
 * 繰り返しの規則(タスクの repeat の選択肢の value)。Todoist の「毎日 / 平日 / 毎週 / 隔週 / 毎月 / 毎年」に寄せる。
 * 次回の期限は、元の期限から数える(Todoist の every)。「完了した日から数える」を付けると完了日から(every!)
 */
export const REPEAT_RULES = ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly'] as const
export type RepeatRule = (typeof REPEAT_RULES)[number]

/** タスク追加欄で読み取る言葉 */
export const REPEAT_WORDS: Record<string, RepeatRule> = {
  毎日: 'daily',
  まいにち: 'daily',
  平日: 'weekdays',
  毎週: 'weekly',
  まいしゅう: 'weekly',
  隔週: 'biweekly',
  毎月: 'monthly',
  まいつき: 'monthly',
  毎年: 'yearly',
  まいとし: 'yearly',
}

export function nextDue(from: string, rule: string): string | null {
  switch (rule as RepeatRule) {
    case 'daily':
      return addDays(from, 1)
    case 'weekdays': {
      let d = addDays(from, 1)
      while ([0, 6].includes(parseISODate(d).getDay())) d = addDays(d, 1)
      return d
    }
    case 'weekly':
      return addDays(from, 7)
    case 'biweekly':
      return addDays(from, 14)
    case 'monthly':
      return addMonthsKeepDay(from, 1)
    case 'yearly':
      // 2/29 は翌年 2/28 に
      return addMonthsKeepDay(from, 12)
    default:
      return null
  }
}
