import { useQueries } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Ellipsis, Plus, Trash2, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { FieldMeta, Filter, MetaResponse, ObjectMeta, RefRecord, Row } from '@/api/types'
import { IconButton, Kbd, ObjectIcon } from '@/components/ui/basics'
import { Popover } from '@/components/ui/overlay'
import { useDeleteRecord, useUpdateRecord } from '@/data/mutations'
import { findObject, keys, useRecord, useRecords } from '@/data/queries'
import { useCompletion } from '@/data/useCompletion'
import { cx } from '@/lib/cx'
import { formatDateTime } from '@/lib/dates'
import { isPlainKey, isTyping, useKeydown } from '@/lib/hotkeys'
import { fieldOf, recordName } from '@/lib/records'
import { PanelScope, usePeek, type PeekRef } from '@/lib/usePeek'
import { isOverlayOpen, useUI } from '@/state/ui'
import { ActivityTimeline } from './ActivityTimeline'
import { FieldEditor } from './FieldEditor'
import { FieldValue } from './FieldValue'
import { TaskCheck } from './TaskCheck'

// ---------------------------------------------------------------------------
// 関連リスト — このレコードを指している他テーブルのレコード(Salesforce の関連リストに当たる)
// ---------------------------------------------------------------------------

interface Relationship {
  child: ObjectMeta
  field: FieldMeta
  filter: Filter
}

/** メタデータから「このテーブルを参照している列」を探す。テーブルが増えても自動で関連リストが増える */
function relationshipsTo(meta: MetaResponse, parent: ObjectMeta, id: string): Relationship[] {
  const out: Relationship[] = []
  for (const child of meta.objects) {
    // 活動(時系列)は関連リストではなく、専用のタイムラインで出す
    if (child.timeline) continue
    for (const field of child.fields) {
      if (field.type === 'relation' && field.target === parent.key) {
        out.push({ child, field, filter: { field: field.key, op: 'eq', value: id } })
      } else if (field.type === 'polymorphic' && field.columns && field.targets?.includes(parent.key)) {
        out.push({
          child,
          field,
          filter: {
            and: [
              { field: field.columns.object, op: 'eq', value: parent.key },
              { field: field.columns.id, op: 'eq', value: id },
            ],
          },
        })
      }
    }
  }
  // タスクのように完了できるテーブルを先頭に(次にやることが一番上に来る)
  return out.sort((a, b) => Number(Boolean(b.child.completion)) - Number(Boolean(a.child.completion)) || a.child.position - b.child.position)
}

function RelatedList({ meta, parent, parentRef, rel }: { meta: MetaResponse; parent: ObjectMeta; parentRef: RefRecord; rel: Relationship }) {
  const { child, field } = rel
  const [showDone, setShowDone] = useState(false)
  const { openPeek } = usePeek()
  const openCreate = useUI((s) => s.openCreate)
  const openQuickAdd = useUI((s) => s.openQuickAdd)

  const c = child.completion
  const filter: Filter = useMemo(
    () => (c && !showDone ? { and: [rel.filter, { field: c.field, op: 'ne', value: c.done_value }] } : rel.filter),
    [rel.filter, c, showDone],
  )
  const deadline = child.fields.find((f) => f.semantic === 'deadline')
  const { data } = useRecords(child.key, {
    filter,
    sort: deadline ? [{ field: deadline.key, dir: 'asc' }] : [{ field: 'updated_at', dir: 'desc' }],
  })
  const all = useRecords(child.key, { filter: rel.filter, limit: 0 }, Boolean(c))
  const completion = useCompletion(child, filter)
  const rows = data?.records ?? []
  const doneCount = c && all.data && data ? all.data.total - (showDone ? rows.filter((r) => r[c.field] !== c.done_value).length : data.total) : 0

  // 一覧に添える列: 選択肢(フェーズ・状況)、金額、締め切り
  const extras = [
    child.fields.find((f) => f.type === 'select' && f.options?.some((o) => o.kind) && f.key !== c?.field),
    child.fields.find((f) => f.type === 'currency'),
    deadline,
    child.key === 'contacts' ? fieldOf(child, 'title') : undefined,
  ].filter((f): f is FieldMeta => Boolean(f))

  const add = () => {
    if (c) {
      // タスク: 関連先か取引先責任者を最初から入れて、追加欄を開く
      if (field.type === 'polymorphic') openQuickAdd({ related: { object: parent.key, ref: parentRef } })
      else openQuickAdd({ contact: parentRef })
      return
    }
    openCreate(child.key, { [field.key]: parentRef.id }, { [field.key]: parentRef })
  }

  return (
    <section className="border-t border-line px-5 py-4">
      <header className="flex items-center gap-2">
        <ObjectIcon icon={child.icon} color={child.color} size={14} />
        <h3 className="font-bold">{child.label}</h3>
        <span className="text-sm text-ink-3 tabular-nums">{data?.total ?? ''}</span>
        <button
          type="button"
          onClick={add}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm text-ink-2 hover:bg-sunken hover:text-ink"
        >
          <Plus size={13} aria-hidden />
          追加
        </button>
      </header>

      {rows.length > 0 ? (
        <ul className="m-0 mt-1.5 list-none p-0">
          {rows.map((row) => (
            <li key={row.id} className={cx(completion.leaving.has(row.id) && 'row-leaving')}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => openPeek(child.key, row.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target === e.currentTarget) openPeek(child.key, row.id)
                }}
                className="-mx-2 flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 hover:bg-chrome"
              >
                {c && <TaskCheck meta={child} row={row} checked={completion.isChecked(row)} onToggle={() => completion.complete(row)} />}
                <span className={cx('min-w-0 flex-1 truncate', completion.isChecked(row) && 'text-ink-3 line-through')}>
                  {recordName(child, row)}
                </span>
                {extras.map((f) => (
                  <span key={f.key} className="flex-none text-sm text-ink-2 empty:hidden">
                    <FieldValue meta={meta} object={child} field={f} row={row} references={data?.references ?? {}} />
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-sm text-ink-3">{c ? '残っているタスクはありません' : `${child.label}はまだありません`}</p>
      )}

      {c && (doneCount > 0 || showDone) && (
        <button type="button" onClick={() => setShowDone((v) => !v)} className="mt-1 text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          {showDone ? '完了済みを隠す' : `完了済みの ${doneCount} 件も表示`}
        </button>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// パネル本体
// ---------------------------------------------------------------------------

function PanelBody({ meta, object, row, references }: { meta: MetaResponse; object: ObjectMeta; row: Row; references: Parameters<typeof FieldEditor>[0]['references'] }) {
  const update = useUpdateRecord()
  const completion = useCompletion(object, undefined)
  const nameField = fieldOf(object, object.name_field)
  const fields = object.fields.filter((f) => f.key !== object.name_field && !f.readonly)
  const stamps = object.fields.filter((f) => f.readonly && f.type === 'datetime' && row[f.key])
  const parentRef: RefRecord = { id: row.id, name: recordName(object, row) }
  const relationships = useMemo(() => relationshipsTo(meta, object, row.id), [meta, object, row.id])
  // 次にやること(タスク)→ これまでの記録(活動)→ ほかの関連、の順
  const timelines = meta.objects.filter((o) => o.timeline && o.key !== object.key)
  const todo = relationships.filter((r) => r.child.completion)
  const rest = relationships.filter((r) => !r.child.completion)

  const commit: Parameters<typeof FieldEditor>[0]['onCommit'] = (patch, refs) =>
    update.mutate({ object: object.key, id: row.id, patch, refs })

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-start gap-3 px-5 pt-5 pb-2">
        {object.completion && (
          <span className="mt-2">
            <TaskCheck meta={object} row={row} checked={completion.isChecked(row)} onToggle={() => completion.complete(row)} />
          </span>
        )}
        {nameField && (
          <div className="-ml-2 min-w-0 flex-1 [&_input]:h-10 [&_input]:text-xl [&_input]:font-bold">
            <FieldEditor meta={meta} object={object} field={nameField} row={row} references={references} onCommit={commit} />
          </div>
        )}
      </div>

      <dl className="m-0 grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5 px-5 pb-5">
        {fields.map((f) => (
          <div key={f.key} className="contents">
            <dt className="flex h-8 items-center truncate text-ink-2">{f.label}</dt>
            <dd className="m-0 min-w-0">
              <FieldEditor meta={meta} object={object} field={f} row={row} references={references} onCommit={commit} />
            </dd>
          </div>
        ))}
      </dl>

      {todo.map((rel) => (
        <RelatedList key={`${rel.child.key}.${rel.field.key}`} meta={meta} parent={object} parentRef={parentRef} rel={rel} />
      ))}
      {timelines.map((o) => (
        <ActivityTimeline key={o.key} meta={meta} activities={o} parent={object} parentRef={parentRef} />
      ))}
      {rest.map((rel) => (
        <RelatedList key={`${rel.child.key}.${rel.field.key}`} meta={meta} parent={object} parentRef={parentRef} rel={rel} />
      ))}

      {stamps.length > 0 && (
        <p className="border-t border-line px-5 py-4 text-sm text-ink-3">
          {stamps.map((f) => `${f.label} ${formatDateTime(String(row[f.key]))}`).join(' / ')}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ぱんくず — たどってきたレコード(取引先 › 取引先責任者 › 商談)。途中を押すと、そこへ戻る
// ---------------------------------------------------------------------------

function Breadcrumbs({ meta, trail, onGo }: { meta: MetaResponse; trail: PeekRef[]; onGo: (index: number) => void }) {
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const ancestors = trail.slice(0, -1)
  // 名前は開いたときに読んだものが手元にある。URL から直接開いたときだけ取りに行く
  const records = useQueries({
    queries: ancestors.map((t) => ({
      queryKey: keys.record(t.object, t.id),
      queryFn: () => api.getRecord(t.object, t.id),
      enabled: Boolean(findObject(meta, t.object)),
    })),
  })
  const crumbs = ancestors.map((t, index) => {
    const object = findObject(meta, t.object)
    const row = records[index]?.data?.record
    return { index, object, name: object && row ? recordName(object, row) : (object?.label ?? '…') }
  })
  // 長い経路は、最初と直前だけを出して、あいだを「…」に畳む
  const folded = crumbs.length > 2 ? crumbs.slice(1, -1) : []
  const shown = folded.length > 0 ? [crumbs[0], crumbs[crumbs.length - 1]] : crumbs
  const current = findObject(meta, trail[trail.length - 1]?.object)
  const separator = <ChevronRight size={13} className="flex-none text-ink-3" aria-hidden />
  const itemCls = 'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-ink hover:bg-sunken'

  return (
    <nav aria-label="たどってきたレコード" className="min-w-0 flex-1">
      <ol className="m-0 flex min-w-0 list-none items-center gap-1 p-0">
        {shown.map((c, i) => (
          <Fragment key={c.index}>
            <li className="flex min-w-[3.5rem] shrink items-center">
              <button
                type="button"
                onClick={() => onGo(c.index)}
                title={`${c.object?.label ?? ''}「${c.name}」へ戻る`}
                className="-mx-1 flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-ink-2 hover:bg-sunken hover:text-ink"
              >
                {c.object && <ObjectIcon icon={c.object.icon} color={c.object.color} size={12} />}
                <span className="max-w-[11rem] truncate">{c.name}</span>
              </button>
            </li>
            <li className="flex flex-none items-center" aria-hidden>
              {separator}
            </li>
            {i === 0 && folded.length > 0 && (
              <>
                <li className="flex flex-none items-center">
                  <IconButton label={`あいだの ${folded.length} 件を表示`} aria-haspopup="menu" onClick={(e) => setMenu(e.currentTarget)}>
                    <Ellipsis size={15} />
                  </IconButton>
                </li>
                <li className="flex flex-none items-center" aria-hidden>
                  {separator}
                </li>
              </>
            )}
          </Fragment>
        ))}
        {current && (
          <li aria-current="page" className="flex flex-none items-center gap-2">
            <ObjectIcon icon={current.icon} color={current.color} size={14} />
            <span className={ancestors.length > 0 ? 'text-ink' : 'text-ink-2'}>{current.label}</span>
          </li>
        )}
      </ol>
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} width={260}>
          <div role="menu" className="p-1.5">
            {folded.map((c) => (
              <button
                key={c.index}
                type="button"
                role="menuitem"
                className={itemCls}
                onClick={() => {
                  setMenu(null)
                  onGo(c.index)
                }}
              >
                {c.object && <ObjectIcon icon={c.object.icon} color={c.object.color} size={12} />}
                <span className="truncate">{c.name}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </nav>
  )
}

const PANEL_WIDTH_KEY = 'works.panel.width'
const PANEL_MIN = 420

/** パネルの左端をつまんで幅を変える。幅は覚えておく。ダブルクリックで既定に戻す */
function usePanelWidth() {
  const [width, setWidth] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY))
    return saved >= PANEL_MIN ? saved : null
  })
  const [dragging, setDragging] = useState(false)
  const latest = useRef(width)
  const lastDown = useRef(0)

  const clamp = (w: number) => Math.round(Math.max(PANEL_MIN, Math.min(w, innerWidth - 320)))
  const reset = () => {
    localStorage.removeItem(PANEL_WIDTH_KEY)
    latest.current = null
    setWidth(null)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    // 2 回続けて押したら既定の幅へ(pointerdown の detail は仕様上つねに 0 なので、自前で数える)
    const now = Date.now()
    const twice = now - lastDown.current < 400
    lastDown.current = now
    if (twice) return reset()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    const move = (ev: PointerEvent) => {
      latest.current = clamp(innerWidth - ev.clientX)
      setWidth(latest.current)
    }
    const up = () => {
      setDragging(false)
      if (latest.current) localStorage.setItem(PANEL_WIDTH_KEY, String(latest.current))
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      removeEventListener('pointercancel', up)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', up)
  }
  // つまんでいる間は、文字を選択させない
  useEffect(() => {
    if (!dragging) return
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    return () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [dragging])

  return { width, dragging, onPointerDown, reset }
}

export function RecordPanel({ meta }: { meta: MetaResponse }) {
  const { peek, trail, goTo, back, closePeek } = usePeek()
  const panel = usePanelWidth()
  const object = findObject(meta, peek?.object)
  const { data, isPending, isError } = useRecord(object?.key, peek?.id)
  const remove = useDeleteRecord()

  useKeydown((e) => {
    if (!isPlainKey(e) || isTyping(e) || isOverlayOpen()) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closePeek()
    } else if (e.key === 'Backspace' && trail.length > 1) {
      e.preventDefault()
      back()
    }
  }, Boolean(peek))

  if (!peek || !object) return null

  return (
    <aside
      aria-label={`${object.label}の詳細`}
      // 幅は CSS 変数で渡す。狭い画面(sm 未満)では変数を使わず全幅
      style={panel.width ? ({ '--panel-w': `${panel.width}px` } as React.CSSProperties) : undefined}
      className="fixed inset-y-0 right-0 z-40 flex w-full animate-panel-in flex-col border-l border-line bg-paper shadow-pop sm:w-(--panel-w,540px) lg:w-(--panel-w,620px)"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="パネルの幅を変える(ダブルクリックで元の幅)"
        title="ドラッグで幅を変える。ダブルクリックで元の幅"
        onPointerDown={panel.onPointerDown}
        className={cx(
          'absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize sm:block',
          'after:absolute after:inset-y-0 after:left-1 after:w-0.5 after:bg-accent after:opacity-0 after:transition-opacity after:duration-150 after:content-[""] hover:after:opacity-100',
          panel.dragging && 'after:opacity-100',
        )}
      />
      <header className={cx('flex h-12 flex-none items-center gap-2 border-b border-line pr-2', trail.length > 1 ? 'pl-2.5' : 'pl-5')}>
        {trail.length > 1 && (
          <IconButton label="前のレコードへ戻る (Backspace)" onClick={back}>
            <ArrowLeft size={16} />
          </IconButton>
        )}
        <Breadcrumbs meta={meta} trail={trail} onGo={goTo} />
        <div className="flex flex-none items-center gap-0.5">
          {data && (
            <IconButton
              label="削除"
              className="hover:bg-danger-wash hover:text-danger"
              onClick={() => {
                remove.mutate({ object: object.key, row: data.record, label: `「${recordName(object, data.record)}」` })
                // たどってきた途中なら、1 つ前のレコードへ戻る
                back()
              }}
            >
              <Trash2 size={15} />
            </IconButton>
          )}
          <button
            type="button"
            onClick={closePeek}
            className="inline-flex h-7 items-center gap-1.5 rounded-md pr-1.5 pl-2 text-ink-2 hover:bg-sunken hover:text-ink"
            aria-label="パネルを閉じる"
          >
            <X size={16} aria-hidden />
            <span className="hidden sm:inline-grid">
              <Kbd>Esc</Kbd>
            </span>
          </button>
        </div>
      </header>

      {data ? (
        <PanelScope.Provider value={true}>
          <PanelBody key={data.record.id} meta={meta} object={object} row={data.record} references={data.references} />
        </PanelScope.Provider>
      ) : (
        <p className="p-5 text-ink-2">
          {isError ? 'このレコードは見つかりません。削除された可能性があります。' : isPending ? '読み込んでいます…' : null}
        </p>
      )}
    </aside>
  )
}
