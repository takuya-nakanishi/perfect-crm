import type { ListViewConfig } from '@/api/types'

/**
 * 一覧の列の幅。ビューの定義(`config.columns[].width`)に px で持ち、見出しの右端をつまんで変える(05 §12)。
 * 列の合計が画面より狭ければ右は余白、広ければ横スクロール。スマホ幅では 7 割で描く(一覧の `--col-scale`)
 */
export const COLUMN_MIN = 60
export const COLUMN_MAX = 1200
const COLUMN_DEFAULT = 160

type Columns = ListViewConfig['columns']

/** 保存してある幅を、描ける幅に揃える。無い・数でなければ既定、範囲の外は端、端数は丸める */
export function columnWidth(width: number | undefined): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return COLUMN_DEFAULT
  return Math.round(Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, width)))
}

/**
 * CSS grid の列の並び。末尾の `minmax(0, 1fr)` が余りを受けるので、列の合計が狭くても行の罫線と選択の色は右端まで届く。
 * `max-content` は、ダブルクリックで中身に合わせるときに測るためだけに使う
 */
export function columnTemplate(widths: (number | 'max-content')[]): string {
  return [...widths.map((w) => (w === 'max-content' ? w : `calc(${w}px * var(--col-scale))`)), 'minmax(0, 1fr)'].join(' ')
}

/** 表の最小の幅(列の合計)。これより狭い画面では横スクロールになる */
export function tableMinWidth(widths: number[]): string {
  return `calc(${widths.reduce((sum, w) => sum + w, 0)}px * var(--col-scale))`
}

/** 1 つの列の幅を変えた定義。ほかの列と、列の並びはそのまま */
export function withColumnWidth(columns: Columns, field: string, width: number): Columns {
  return columns.map((c) => (c.field === field ? { ...c, width: columnWidth(width) } : c))
}
