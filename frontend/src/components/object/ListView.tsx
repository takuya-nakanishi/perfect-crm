import { ArrowDown, ArrowUp } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { FieldMeta, ListViewConfig, MetaResponse, ObjectMeta, Sort } from '@/api/types'
import { FieldValue } from '@/components/record/FieldValue'
import { TaskCheck } from '@/components/record/TaskCheck'
import { useRecords } from '@/data/queries'
import { useCompletion } from '@/data/useCompletion'
import { columnTemplate, columnWidth, tableMinWidth, withColumnWidth } from '@/lib/columns'
import { cx } from '@/lib/cx'
import { formatNumber, formatYen } from '@/lib/format'
import { isPlainKey, isTyping, useKeydown } from '@/lib/hotkeys'
import { fieldOf, recordName } from '@/lib/records'
import { usePeek } from '@/lib/usePeek'
import { isOverlayOpen } from '@/state/ui'
import { EmptyState } from './EmptyState'

const RIGHT_ALIGNED = new Set(['currency', 'number', 'percent'])

export function ListView({
  meta,
  object,
  config,
  q,
  viewName,
  onColumnsChange,
}: {
  meta: MetaResponse
  object: ObjectMeta
  config: ListViewConfig
  q: string
  viewName: string
  /** 列の幅を変えたとき。ビューの定義に保存する(ほかのビューの設定と同じく、その場で) */
  onColumnsChange: (columns: ListViewConfig['columns']) => void
}) {
  const [userSort, setUserSort] = useState<Sort | null>(null)
  const sort = useMemo(() => (userSort ? [userSort] : config.sort), [userSort, config.sort])
  const { data, isPending } = useRecords(object.key, { filter: config.filter, sort, q: q || undefined })
  // 行の強調と J/K は、経路の起点(この一覧から開いたレコード)で見る。パネルの中で先へ進んでも、行の選択は動かない
  const { root: peek, openPeek } = usePeek()
  const { leaving, complete, isChecked } = useCompletion(object, config.filter)
  const [selected, setSelected] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  const columns = useMemo(
    () =>
      config.columns
        .map((c) => ({ field: c.field, width: columnWidth(c.width), meta: fieldOf(object, c.field) }))
        .filter((c): c is { field: string; width: number; meta: FieldMeta } => Boolean(c.meta)),
    [config.columns, object],
  )
  // 列の幅は px(ビューの定義)。合計が画面より狭ければ右は余白、広ければ横スクロール。スマホ幅では 7 割で描く(05 §12)
  const widths = columns.map((c) => c.width)
  const startResize = useColumnResize(tableRef, widths, (index, width) =>
    onColumnsChange(withColumnWidth(config.columns, columns[index].field, width)),
  )

  const rows = data?.records ?? []
  const references = data?.references ?? {}

  // パネルで開いているレコードがこの一覧にあれば、その行を選択中として扱う
  const activeId = peek?.object === object.key && rows.some((r) => r.id === peek.id) ? peek.id : selected

  useEffect(() => {
    if (!activeId) return
    bodyRef.current?.querySelector(`[data-row="${activeId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  useKeydown((e) => {
    if (isTyping(e) || !isPlainKey(e) || isOverlayOpen() || rows.length === 0) return
    const index = rows.findIndex((r) => r.id === activeId)
    const move = (delta: number) => {
      e.preventDefault()
      const next = rows[Math.max(0, Math.min(rows.length - 1, index < 0 ? 0 : index + delta))]
      setSelected(next.id)
      // パネルを開いたまま上下すると、パネルの中身も付いてくる
      if (peek?.object === object.key) openPeek(object.key, next.id, { replace: true })
    }
    if (e.key === 'j' || e.key === 'ArrowDown') move(1)
    else if (e.key === 'k' || e.key === 'ArrowUp') move(-1)
    else if ((e.key === 'Enter' || e.key === 'o') && index >= 0 && !(e.target as HTMLElement).closest('button, a')) {
      e.preventDefault()
      openPeek(object.key, rows[index].id)
    } else if (e.key === 'e' && index >= 0 && object.completion) {
      e.preventDefault()
      complete(rows[index])
      const neighbor = rows[index + 1] ?? rows[index - 1]
      setSelected(neighbor ? neighbor.id : null)
    } else if (e.key === 'Escape' && !peek && selected) {
      setSelected(null)
    }
  })

  const toggleSort = (field: FieldMeta) => {
    if (field.type === 'polymorphic') return
    setUserSort((prev) =>
      prev?.field !== field.key ? { field: field.key, dir: 'asc' } : prev.dir === 'asc' ? { field: field.key, dir: 'desc' } : null,
    )
  }

  const sums = columns
    .filter((c) => c.meta.type === 'currency')
    .map((c) => ({ label: c.meta.label, total: rows.reduce((sum, r) => sum + (typeof r[c.field] === 'number' ? (r[c.field] as number) : 0), 0) }))

  if (!isPending && rows.length === 0) {
    return <EmptyState object={object} viewName={viewName} filtered={Boolean(q)} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto" role="table" aria-label={`${object.label}の一覧`}>
        {/* 列の並びは CSS 変数で渡し、見出しと行が同じものを使う。幅を変えている間は変数だけを書き換える(useColumnResize) */}
        <div
          ref={tableRef}
          className="[--col-scale:0.7] sm:[--col-scale:1]"
          style={{ '--cols': columnTemplate(widths), minWidth: tableMinWidth(widths) } as CSSProperties}
        >
          <div role="row" className="sticky top-0 z-10 grid grid-cols-(--cols) border-b border-line bg-paper text-sm text-ink-2">
            {columns.map((c, i) => {
              const active = userSort?.field === c.field
              const sortable = c.meta.type !== 'polymorphic'
              return (
                <div
                  key={c.field}
                  role="columnheader"
                  aria-label={c.meta.label}
                  aria-sort={active ? (userSort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className="relative min-w-0"
                >
                  <button
                    type="button"
                    disabled={!sortable}
                    onClick={() => toggleSort(c.meta)}
                    className={cx(
                      'flex h-9 w-full min-w-0 items-center gap-1 px-3 text-left',
                      i === 0 && 'pl-5',
                      i === 0 && object.completion && 'pl-[52px]',
                      RIGHT_ALIGNED.has(c.meta.type) && 'justify-end',
                      sortable && 'hover:text-ink',
                    )}
                  >
                    <span className="truncate">{c.meta.label}</span>
                    {active ? (
                      userSort.dir === 'asc' ? (
                        <ArrowUp size={12} className="flex-none text-accent" aria-hidden />
                      ) : (
                        <ArrowDown size={12} className="flex-none text-accent" aria-hidden />
                      )
                    ) : null}
                  </button>
                  {/* 右端の 8px をつまむと幅が変わる。触れると境目に緑の線、つまんでいる間は線を一覧の下まで伸ばす */}
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`「${c.meta.label}」の幅を変える(ダブルクリックで中身に合わせる)`}
                    title="ドラッグで幅を変える。ダブルクリックで中身に合わせる"
                    onPointerDown={(e) => startResize(e, i)}
                    className={cx(
                      'absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none',
                      'after:absolute after:top-0 after:left-[3px] after:h-full after:w-0.5 after:bg-accent after:opacity-0 after:transition-opacity after:duration-150 after:content-[""] hover:after:opacity-100',
                      'data-active:after:h-[100dvh] data-active:after:opacity-100',
                    )}
                  />
                </div>
              )
            })}
          </div>

          {rows.map((row) => {
            const isActive = row.id === activeId
            return (
              <div
                key={row.id}
                role="row"
                data-row={row.id}
                aria-selected={isActive}
                onClick={() => {
                  setSelected(row.id)
                  openPeek(object.key, row.id)
                }}
                // 画面の外の行は描かない(content-visibility)。数百行でも、幅を変えている間に並べ直すのは見えている行だけ。
                // 中身に合わせて測る間(data-measuring)だけは全部の行を描く
                className={cx(
                  'grid grid-cols-(--cols) cursor-pointer border-b border-line text-ink-2 transition-colors duration-75',
                  '[contain-intrinsic-block-size:auto_41px] [content-visibility:auto] in-data-measuring:[content-visibility:visible]',
                  isActive ? 'bg-accent-wash shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-chrome',
                  leaving.has(row.id) && 'row-leaving',
                )}
              >
                {columns.map((c, i) => (
                  <div
                    key={c.field}
                    role="cell"
                    // 中身は列の端で切る(隣の列へはみ出さない。J-042)
                    className={cx(
                      'flex h-10 min-w-0 items-center overflow-hidden px-3',
                      i === 0 && 'gap-3 pl-5 text-ink',
                      RIGHT_ALIGNED.has(c.meta.type) && 'justify-end',
                    )}
                  >
                    {i === 0 && object.completion && (
                      <TaskCheck meta={object} row={row} checked={isChecked(row)} onToggle={() => complete(row)} />
                    )}
                    {i === 0 ? (
                      <span className={cx('truncate', isChecked(row) && 'text-ink-3 line-through')}>{recordName(object, row)}</span>
                    ) : (
                      <FieldValue meta={meta} object={object} field={c.meta} row={row} references={references} onOpenRecord={openPeek} singleLine />
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      <footer className="flex h-9 flex-none items-center gap-5 border-t border-line bg-paper px-5 text-sm text-ink-2">
        <span className="tabular-nums">{formatNumber(data?.total ?? 0)} 件</span>
        {sums.map((s) => (
          <span key={s.label}>
            {s.label}の合計 <span className="text-ink tabular-nums">{formatYen(s.total)}</span>
          </span>
        ))}
      </footer>
    </div>
  )
}

/**
 * 見出しの右端をつまんで列の幅を変える(05 §12)。動かしている間は表の CSS 変数だけを書き換え、行は描き直さない
 * (数百行 × 数十列を毎フレーム描き直すと重い)。離したら保存する。2 回続けて押すと、その列の中身に合わせる
 */
function useColumnResize(
  tableRef: RefObject<HTMLDivElement | null>,
  widths: number[],
  onResize: (index: number, width: number) => void,
) {
  const lastDown = useRef({ index: -1, at: 0 })

  const apply = (next: (number | 'max-content')[]) => {
    const table = tableRef.current
    if (!table) return
    table.style.setProperty('--cols', columnTemplate(next))
    table.style.minWidth = tableMinWidth(next.map((w, i) => (w === 'max-content' ? widths[i] : w)))
  }
  // スマホ幅では列を 7 割で描いている。画面の上で動かした量を、定義の幅に直すのに使う
  const scaleOf = (table: HTMLElement) => Number.parseFloat(getComputedStyle(table).getPropertyValue('--col-scale')) || 1

  /**
   * 測る間だけその列を max-content にする。行ごとに別の grid なので、各行のその列の幅 = そのセルの中身の幅。
   * 画面の外の行も測るので、その間は全部の行を描かせる(描いていない行を 1 つずつ測らせると数倍遅い)
   */
  const fit = (index: number) => {
    const table = tableRef.current
    if (!table) return
    table.dataset.measuring = ''
    apply(widths.map((w, i) => (i === index ? 'max-content' : w)))
    const cells = table.querySelectorAll<HTMLElement>(`:scope > [role=row] > :nth-child(${index + 1})`)
    const widest = Math.max(0, ...Array.from(cells, (cell) => cell.getBoundingClientRect().width))
    delete table.dataset.measuring
    const width = columnWidth(Math.ceil(widest / scaleOf(table)))
    apply(widths.with(index, width))
    if (width !== widths[index]) onResize(index, width)
  }

  return (e: ReactPointerEvent<HTMLElement>, index: number) => {
    const table = tableRef.current
    if (e.button !== 0 || !table) return
    e.preventDefault()
    // 2 回続けて押したら中身に合わせる(pointerdown の detail は仕様上つねに 0 なので自前で数える。パネルの幅と同じ)
    const now = Date.now()
    const twice = lastDown.current.index === index && now - lastDown.current.at < 400
    lastDown.current = { index, at: now }
    if (twice) return fit(index)

    const handle = e.currentTarget
    const scale = scaleOf(table)
    const start = widths[index]
    const x0 = e.clientX
    let width = start
    handle.setPointerCapture(e.pointerId)
    handle.dataset.active = ''
    // つまんでいる間は文字を選択させず、どこにいても列の幅を変えるカーソルにする
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const move = (ev: PointerEvent) => {
      width = columnWidth(start + (ev.clientX - x0) / scale)
      apply(widths.with(index, width))
    }
    const end = (ev: PointerEvent) => {
      delete handle.dataset.active
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', end)
      removeEventListener('pointercancel', end)
      if (ev.type === 'pointercancel') return apply(widths)
      if (width !== start) onResize(index, width)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', end)
    addEventListener('pointercancel', end)
  }
}
