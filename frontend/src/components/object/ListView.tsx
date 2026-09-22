import { ArrowDown, ArrowUp } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FieldMeta, ListViewConfig, MetaResponse, ObjectMeta, Sort } from '@/api/types'
import { FieldValue } from '@/components/record/FieldValue'
import { TaskCheck } from '@/components/record/TaskCheck'
import { useRecords } from '@/data/queries'
import { useCompletion } from '@/data/useCompletion'
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
}: {
  meta: MetaResponse
  object: ObjectMeta
  config: ListViewConfig
  q: string
  viewName: string
}) {
  const [userSort, setUserSort] = useState<Sort | null>(null)
  const sort = useMemo(() => (userSort ? [userSort] : config.sort), [userSort, config.sort])
  const { data, isPending } = useRecords(object.key, { filter: config.filter, sort, q: q || undefined })
  // 行の強調と J/K は、経路の起点(この一覧から開いたレコード)で見る。パネルの中で先へ進んでも、行の選択は動かない
  const { root: peek, openPeek } = usePeek()
  const { leaving, complete, isChecked } = useCompletion(object, config.filter)
  const [selected, setSelected] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const columns = useMemo(
    () =>
      config.columns
        .map((c) => ({ ...c, meta: fieldOf(object, c.field) }))
        .filter((c): c is { field: string; width?: number; meta: FieldMeta } => Boolean(c.meta)),
    [config.columns, object],
  )
  // 列幅はビューの定義の比率で画面いっぱいに配る。狭い画面では 7 割まで縮め、それ以下は横スクロール
  const minOf = (width = 160) => Math.round(width * 0.7)
  const template = columns.map((c) => `minmax(${minOf(c.width)}px, ${c.width ?? 160}fr)`).join(' ')
  const minWidth = columns.reduce((sum, c) => sum + minOf(c.width), 0)

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
        <div style={{ minWidth }} className="min-w-full">
          <div
            role="row"
            className="sticky top-0 z-10 grid border-b border-line bg-paper text-sm text-ink-2"
            style={{ gridTemplateColumns: template }}
          >
            {columns.map((c, i) => {
              const active = userSort?.field === c.field
              const sortable = c.meta.type !== 'polymorphic'
              return (
                <button
                  key={c.field}
                  type="button"
                  role="columnheader"
                  aria-sort={active ? (userSort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  disabled={!sortable}
                  onClick={() => toggleSort(c.meta)}
                  className={cx(
                    'group/h flex h-9 min-w-0 items-center gap-1 px-3 text-left',
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
                className={cx(
                  'grid cursor-pointer border-b border-line text-ink-2 transition-colors duration-75',
                  isActive ? 'bg-accent-wash shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-chrome',
                  leaving.has(row.id) && 'row-leaving',
                )}
                style={{ gridTemplateColumns: template }}
              >
                {columns.map((c, i) => (
                  <div
                    key={c.field}
                    role="cell"
                    className={cx(
                      'flex h-10 min-w-0 items-center px-3',
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
                      <FieldValue meta={meta} object={object} field={c.meta} row={row} references={references} onOpenRecord={openPeek} />
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
