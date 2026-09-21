import { Table2, TriangleAlert } from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { AggregateRow, WidgetFormat } from '@/api/types'
import { cx } from '@/lib/cx'
import { formatByWidget, formatPercent } from '@/lib/format'

/*
 * グラフの部品。決めごとは dataviz の手引きに沿う:
 * - 棒は細く(24px 以下)、値の側だけ角を丸め、基準線の側は直角
 * - 目盛り線は実線の細い線で控えめに。値のラベルは要所だけ、残りはツールチップと表で読める
 * - 文字はグラフの色を着ない(色は印だけ)。色だけで区別させない
 * - どのグラフにも「表で見る」がある
 */

// ---------------------------------------------------------------------------
// 統計タイル
// ---------------------------------------------------------------------------

export function StatTile({
  title,
  value,
  secondary,
  alert,
  loading,
}: {
  title: string
  value: string
  secondary?: string
  alert?: boolean
  loading?: boolean
}) {
  return (
    <div className="flex min-h-[104px] flex-col justify-between bg-paper px-5 py-4">
      <p className="text-base text-ink-2">{title}</p>
      <div className={cx('mt-2 flex items-baseline gap-2 transition-opacity', loading && 'opacity-40')}>
        <span className={cx('text-2xl font-bold tracking-tight', alert ? 'text-danger' : 'text-ink')}>{value}</span>
        {alert && <TriangleAlert size={16} className="flex-none translate-y-0.5 text-danger" aria-label="要対応" />}
        {secondary && <span className="text-sm text-ink-2">{secondary}</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// グラフの枠(題名・補足・表への切り替え)
// ---------------------------------------------------------------------------

export function ChartCard({
  title,
  description,
  rows,
  format,
  wide,
  loading,
  children,
}: {
  title: string
  description?: string
  rows: AggregateRow[]
  format: WidgetFormat
  wide?: boolean
  loading?: boolean
  children: ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <figure className={cx('m-0 flex min-w-0 flex-col bg-paper px-5 pt-4 pb-5', wide && 'md:col-span-2')}>
      <figcaption className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-ink">{title}</h3>
          {description && <p className="text-sm text-ink-2">{description}</p>}
        </div>
        <button
          type="button"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
          className={cx(
            'inline-flex h-7 flex-none items-center gap-1.5 rounded-md px-2 text-sm',
            asTable ? 'bg-accent-wash text-accent-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink',
          )}
        >
          <Table2 size={13} aria-hidden />
          表で見る
        </button>
      </figcaption>
      <div className={cx('mt-4 min-w-0 flex-1 transition-opacity', loading && 'opacity-40')}>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-3">表示できるデータがありません</p>
        ) : asTable ? (
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.key ?? '__null__'} className="border-b border-line last:border-0">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink-2">
                    {r.label}
                  </th>
                  <td className="py-1.5 text-right text-ink tabular-nums">{formatByWidget(format, r.value, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          children
        )}
      </div>
    </figure>
  )
}

/** マークに添えるツールチップ。値を主、名前を従にする。hover とキーボードのフォーカスの両方で出る */
function MarkTooltip({
  label,
  value,
  share,
  className,
  style,
}: {
  label: string
  value: string
  share?: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      role="tooltip"
      style={style}
      className={cx(
        'pointer-events-none absolute z-20 rounded-md bg-[#1d2620] px-2.5 py-1.5 text-left whitespace-nowrap text-[#f0f4f1] opacity-0 shadow-pop transition-opacity duration-75',
        'group-hover/mark:opacity-100 group-focus-visible/mark:opacity-100 dark:bg-[#2b332d]',
        className,
      )}
    >
      <span className="block text-base font-bold tabular-nums">{value}</span>
      <span className="block text-xs opacity-75">
        {label}
        {share ? `(全体の ${share})` : ''}
      </span>
    </span>
  )
}

const ORDINAL_STEPS = 6

/** 順序のある区分の色。n 個の区分を、濃淡の段(1〜6)の後ろ側へ寄せて割り当てる(薄すぎる段を避ける) */
function ordinalColor(index: number, count: number): string {
  const start = Math.max(1, ORDINAL_STEPS - count + 1)
  return `var(--viz-ord-${Math.min(ORDINAL_STEPS, start + index)})`
}

// ---------------------------------------------------------------------------
// 横棒(区分ごとの大きさを比べる)
// ---------------------------------------------------------------------------

export function BarChart({ rows, format, color }: { rows: AggregateRow[]; format: WidgetFormat; color: 'single' | 'ordinal' }) {
  const max = Math.max(...rows.map((r) => r.value), 0)
  const total = rows.reduce((t, r) => t + r.value, 0)
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {rows.map((r, i) => (
        <li
          key={r.key ?? '__null__'}
          tabIndex={0}
          className="group/mark relative -mx-2 grid h-8 grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-center gap-3 rounded-md px-2 outline-none hover:bg-chrome focus-visible:bg-chrome"
        >
          <span className="truncate text-sm text-ink-2">{r.label}</span>
          <span className="flex h-full min-w-0 items-center">
            <span
              className="h-[18px] flex-none rounded-r-[4px] transition-[filter] group-hover/mark:brightness-110"
              style={{
                // 値のラベルを棒の先に置くぶん(5.5rem)を残して伸ばす
                width: max > 0 ? `max(${r.value > 0 ? 2 : 0}px, calc((100% - 5.5rem) * ${r.value / max}))` : 0,
                background: color === 'ordinal' ? ordinalColor(i, rows.length) : 'var(--viz-1)',
              }}
            />
            <span className="ml-2 flex-none text-sm text-ink tabular-nums">{formatByWidget(format, r.value)}</span>
          </span>
          <MarkTooltip
            className="bottom-full left-[9.5rem] mb-0.5"
            label={r.label}
            value={formatByWidget(format, r.value, false)}
            share={total > 0 ? formatPercent((r.value / total) * 100) : undefined}
          />
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// 縦棒(時間の流れに沿った量)
// ---------------------------------------------------------------------------

/** 目盛りの上限を切りのよい数にする(1・2・5 × 10^n) */
function niceMax(max: number): number {
  if (max <= 0) return 4
  const step = max / 4
  const pow = 10 ** Math.floor(Math.log10(step))
  const unit = [1, 2, 2.5, 5, 10].find((u) => u * pow >= step) ?? 10
  return unit * pow * 4
}

const PLOT_HEIGHT = 176

export function ColumnChart({ rows, format }: { rows: AggregateRow[]; format: WidgetFormat }) {
  const dataMax = Math.max(...rows.map((r) => r.value), 0)
  // 件数のように小さい整数は、目盛りが小数にならないよう上限を 4 の倍数にする
  const top = format === 'number' && dataMax <= 4 ? 4 : niceMax(dataMax)
  const ticks = [0, 1, 2, 3, 4].map((i) => (top / 4) * i)
  // 値のラベルは山の頂上にだけ付ける。同じ高さの山がいくつもあるときは付けない(残りは目盛り・ツールチップ・表で読める)
  const peaks = rows.flatMap((r, i) => (r.value === dataMax && dataMax > 0 ? [i] : []))
  const isPeak = (i: number) => peaks.length <= 2 && peaks.includes(i)
  const sparseLabels = rows.length > 10

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
      <div className="relative" style={{ height: PLOT_HEIGHT }} aria-hidden>
        {ticks.map((t, i) => (
          <span
            key={i}
            className="absolute right-0 block translate-y-1/2 text-xs whitespace-nowrap text-ink-3 tabular-nums"
            style={{ bottom: (PLOT_HEIGHT / 4) * i }}
          >
            {/* 0 には単位を付けない(「¥0」と「2,000万円」が並ぶと単位が揃わない) */}
            {t === 0 ? '0' : formatByWidget(format, t)}
          </span>
        ))}
        {/* 幅を確保するための見えない最大ラベル */}
        <span className="invisible block text-xs whitespace-nowrap tabular-nums">{formatByWidget(format, top)}</span>
      </div>

      <div className="relative" style={{ height: PLOT_HEIGHT }}>
        {ticks.map((_, i) => (
          <span
            key={i}
            className="absolute inset-x-0 block h-px"
            style={{ bottom: (PLOT_HEIGHT / 4) * i, background: i === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)' }}
            aria-hidden
          />
        ))}
        <ul className="absolute inset-0 m-0 flex list-none items-stretch p-0">
          {rows.map((r, i) => (
            <li
              key={r.key ?? i}
              tabIndex={0}
              className="group/mark relative flex min-w-0 flex-1 flex-col items-center justify-end outline-none hover:bg-ink/[0.04] focus-visible:bg-ink/[0.04]"
            >
              {isPeak(i) && (
                <span className="mb-1 text-xs whitespace-nowrap text-ink tabular-nums">{formatByWidget(format, r.value)}</span>
              )}
              <span
                className="w-[min(24px,60%)] flex-none rounded-t-[4px] bg-[var(--viz-1)] transition-[filter] group-hover/mark:brightness-110"
                style={{ height: `${(r.value / top) * PLOT_HEIGHT}px`, minHeight: r.value > 0 ? 2 : 0 }}
              />
              <MarkTooltip
                className={i < rows.length / 2 ? 'left-1/2' : 'right-1/2'}
                style={{ bottom: Math.min(PLOT_HEIGHT - 40, (r.value / top) * PLOT_HEIGHT + (isPeak(i) ? 28 : 8)) }}
                label={r.label}
                value={formatByWidget(format, r.value, false)}
              />
            </li>
          ))}
        </ul>
      </div>

      <span />
      <ul className="m-0 mt-1.5 flex list-none p-0" aria-hidden>
        {rows.map((r, i) => (
          <li key={r.key ?? i} className="min-w-0 flex-1 text-center text-xs whitespace-nowrap text-ink-3 tabular-nums">
            {!sparseLabels || (rows.length - 1 - i) % 2 === 0 ? r.label : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}
