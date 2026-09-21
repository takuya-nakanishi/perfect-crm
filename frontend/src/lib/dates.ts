/** 日付は 'YYYY-MM-DD' の文字列で持ち回る(タイムゾーンのずれを避ける)。計算のときだけ Date にする */

const pad = (n: number) => String(n).padStart(2, '0')
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayISO(): string {
  return toISODate(new Date())
}

export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

export function addMonths(iso: string, n: number): string {
  const d = parseISODate(iso)
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  return toISODate(d)
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseISODate(a).getTime() - parseISODate(b).getTime()) / 86400000)
}

export function startOfMonth(iso: string): string {
  return iso.slice(0, 8) + '01'
}

export function endOfMonth(iso: string): string {
  const d = parseISODate(iso)
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

/** ISO 日時(UTC)を、利用者のタイムゾーンでの日付にする */
export function localDateOf(isoDateTime: string): string {
  return toISODate(new Date(isoDateTime))
}

/** $today / $today+7 / $today-30 / $start_of_month / $end_of_month を日付にする。マクロでなければ null */
export function resolveDateMacro(value: string, today = todayISO()): string | null {
  if (value === '$start_of_month') return startOfMonth(today)
  if (value === '$end_of_month') return endOfMonth(today)
  const m = /^\$today(?:([+-])(\d+))?$/.exec(value)
  if (!m) return null
  return m[1] ? addDays(today, (m[1] === '-' ? -1 : 1) * Number(m[2])) : today
}

export function weekdayOf(iso: string): string {
  return WEEKDAYS[parseISODate(iso).getDay()]
}

/** 2026/09/25 */
export function formatDate(iso: string): string {
  return iso.slice(0, 10).replaceAll('-', '/')
}

/** 期限の表示。近い日は言葉で、遠い日は日付で */
export function formatDue(iso: string, today = todayISO()): string {
  const diff = diffDays(iso, today)
  if (diff === 0) return '今日'
  if (diff === 1) return '明日'
  if (diff === -1) return '昨日'
  if (diff > 1 && diff < 7) return `${weekdayOf(iso)}曜日`
  const d = parseISODate(iso)
  const sameYear = d.getFullYear() === parseISODate(today).getFullYear()
  return `${sameYear ? '' : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日(${weekdayOf(iso)})`
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later'

export function dueTone(iso: string, today = todayISO()): DueTone {
  const diff = diffDays(iso, today)
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff <= 7) return 'soon'
  return 'later'
}

/** 日時の表示。今日なら時刻、今年なら月日、それ以外は年月日 */
export function formatDateTime(isoDateTime: string): string {
  const d = new Date(isoDateTime)
  const date = toISODate(d)
  const time = `${d.getHours()}:${pad(d.getMinutes())}`
  const today = todayISO()
  if (date === today) return `今日 ${time}`
  if (date === addDays(today, -1)) return `昨日 ${time}`
  if (date.slice(0, 4) === today.slice(0, 4)) return `${d.getMonth() + 1}月${d.getDate()}日`
  return formatDate(date)
}

/** '2026-09' → 9月(年が変わる月だけ年を付ける) */
export function monthLabel(key: string, withYear = false): string {
  const [y, m] = key.split('-').map(Number)
  return withYear || m === 1 ? `${y}年${m}月` : `${m}月`
}

/** '2026-09-21' → 9/21 */
export function dayLabel(iso: string): string {
  const d = parseISODate(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
