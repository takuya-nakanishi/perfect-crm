import type { WidgetFormat } from '@/api/types'

const grouped = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 })

/** scale は小数点以下の桁数(項目の定義)。指定があれば、その桁で揃えて出す */
function fixed(n: number, scale: number): string {
  return new Intl.NumberFormat('ja-JP', { minimumFractionDigits: scale, maximumFractionDigits: scale }).format(n)
}

export function formatNumber(n: number, scale?: number): string {
  return scale !== undefined ? fixed(n, scale) : grouped.format(n)
}

/** ¥1,200,000。ja-JP の通貨書式は全角の円記号になるので自前で組む */
export function formatYen(n: number): string {
  return `¥${grouped.format(Math.round(n))}`
}

/** 1.2億円 / 1,240万円 / ¥9,800。大きな数字をひと目で読むための書式 */
export function formatYenCompact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 100_000_000) return `${oneDecimal.format(n / 100_000_000)}億円`
  if (abs >= 10_000) return `${grouped.format(Math.round(n / 10_000))}万円`
  return formatYen(n)
}

export function formatPercent(n: number, scale?: number): string {
  return `${scale !== undefined ? fixed(n, scale) : oneDecimal.format(n)}%`
}

export function formatByWidget(format: WidgetFormat, n: number, compact = true): string {
  if (format === 'currency') return compact ? formatYenCompact(n) : formatYen(n)
  if (format === 'percent') return formatPercent(n)
  return formatNumber(n)
}
