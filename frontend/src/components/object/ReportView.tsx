import type { ChartWidget, ObjectMeta, ReportViewConfig, StatWidget } from '@/api/types'
import { useAggregate } from '@/data/queries'
import { cx } from '@/lib/cx'
import { formatByWidget } from '@/lib/format'
import { BarChart, ChartCard, ColumnChart, StatTile } from './charts/charts'

/**
 * レポート。ビューの定義(widgets)を読み、集計 API の結果をそのまま描く。
 * 画面側は計算しない。数字を作るのはサーバ(いまはモック)の仕事。
 */

function Stat({ object, widget }: { object: ObjectMeta; widget: StatWidget }) {
  const main = useAggregate(object.key, { measure: widget.measure, filter: widget.filter })
  const denominator = useAggregate(
    object.key,
    { measure: widget.measure, filter: widget.denominator_filter },
    Boolean(widget.denominator_filter),
  )
  const secondary = useAggregate(
    object.key,
    { measure: widget.secondary?.measure ?? { op: 'count' }, filter: widget.filter },
    Boolean(widget.secondary),
  )

  const raw = main.data?.rows[0]?.value ?? 0
  const base = denominator.data?.rows[0]?.value ?? 0
  const value = widget.denominator_filter ? (base > 0 ? (raw / base) * 100 : 0) : raw
  const ready = main.data !== undefined && (!widget.denominator_filter || denominator.data !== undefined)

  return (
    <StatTile
      title={widget.title}
      value={ready ? formatByWidget(widget.format, value) : '–'}
      secondary={
        widget.secondary && secondary.data
          ? `${formatByWidget(widget.secondary.format, secondary.data.rows[0]?.value ?? 0)} ${widget.secondary.suffix}`
          : widget.denominator_filter && ready
            ? `${raw} / ${base} 件`
            : undefined
      }
      alert={widget.tone === 'alert' && value > 0}
      loading={main.isPlaceholderData}
    />
  )
}

function Chart({ object, widget, wide }: { object: ObjectMeta; widget: ChartWidget; wide: boolean }) {
  const { data, isPlaceholderData } = useAggregate(object.key, {
    measure: widget.measure,
    filter: widget.filter,
    group_by: widget.group_by,
    order: widget.order,
    limit: widget.limit,
  })
  const rows = data?.rows ?? []
  return (
    <ChartCard title={widget.title} description={widget.description} rows={rows} format={widget.format} wide={wide} loading={isPlaceholderData}>
      {widget.type === 'column' ? (
        <ColumnChart rows={rows} format={widget.format} />
      ) : (
        <BarChart rows={rows} format={widget.format} color={widget.color} />
      )}
    </ChartCard>
  )
}

/** 2 列の格子に隙間なく敷き詰める。行に 1 つだけ残るグラフは横いっぱいに広げる */
function layoutCharts(charts: ChartWidget[]): { widget: ChartWidget; wide: boolean }[] {
  const out: { widget: ChartWidget; wide: boolean }[] = []
  let column = 0
  charts.forEach((widget, i) => {
    let wide = Boolean(widget.wide)
    if (!wide && column === 0) {
      const next = charts[i + 1]
      if (!next || next.wide) wide = true
    }
    column = wide ? 0 : (column + 1) % 2
    out.push({ widget, wide })
  })
  return out
}

export function ReportView({ object, config }: { object: ObjectMeta; config: ReportViewConfig }) {
  const stats = config.widgets.filter((w): w is StatWidget => w.type === 'stat')
  const charts = config.widgets.filter((w): w is ChartWidget => w.type !== 'stat')

  const layout = layoutCharts(charts)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-4 px-5 pt-4 pb-10">
        {stats.length > 0 && (
          <section
            aria-label="主な数字"
            className={cx(
              'grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line',
              stats.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
            )}
          >
            {stats.map((w) => (
              <Stat key={w.id} object={object} widget={w} />
            ))}
          </section>
        )}
        <section aria-label="グラフ" className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-2">
          {layout.map(({ widget, wide }) => (
            <Chart key={widget.id} object={object} widget={widget} wide={wide} />
          ))}
        </section>
      </div>
    </div>
  )
}
