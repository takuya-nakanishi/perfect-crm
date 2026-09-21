import { Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FieldMeta, Filter, MetaResponse, ObjectMeta, RefRecord, Row } from '@/api/types'
import { IconButton, Kbd, ObjectIcon } from '@/components/ui/basics'
import { useDeleteRecord, useUpdateRecord } from '@/data/mutations'
import { findObject, useRecord, useRecords } from '@/data/queries'
import { useCompletion } from '@/data/useCompletion'
import { cx } from '@/lib/cx'
import { formatDateTime } from '@/lib/dates'
import { isPlainKey, isTyping, useKeydown } from '@/lib/hotkeys'
import { fieldOf, recordName } from '@/lib/records'
import { usePeek } from '@/lib/usePeek'
import { isOverlayOpen, useUI } from '@/state/ui'
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

      {relationships.map((rel) => (
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

export function RecordPanel({ meta }: { meta: MetaResponse }) {
  const { peek, closePeek } = usePeek()
  const object = findObject(meta, peek?.object)
  const { data, isPending, isError } = useRecord(object?.key, peek?.id)
  const remove = useDeleteRecord()

  useKeydown((e) => {
    if (e.key === 'Escape' && isPlainKey(e) && !isTyping(e) && !isOverlayOpen()) {
      e.preventDefault()
      closePeek()
    }
  }, Boolean(peek))

  if (!peek || !object) return null

  return (
    <aside
      aria-label={`${object.label}の詳細`}
      className="fixed inset-y-0 right-0 z-40 flex w-full animate-panel-in flex-col border-l border-line bg-paper shadow-pop sm:w-[540px] lg:w-[620px]"
    >
      <header className="flex h-12 flex-none items-center gap-2 border-b border-line pr-2 pl-5">
        <ObjectIcon icon={object.icon} color={object.color} size={14} />
        <span className="text-ink-2">{object.label}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {data && (
            <IconButton
              label="削除"
              className="hover:bg-danger-wash hover:text-danger"
              onClick={() => {
                remove.mutate({ object: object.key, row: data.record, label: `「${recordName(object, data.record)}」` })
                closePeek()
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
        <PanelBody key={data.record.id} meta={meta} object={object} row={data.record} references={data.references} />
      ) : (
        <p className="p-5 text-ink-2">
          {isError ? 'このレコードは見つかりません。削除された可能性があります。' : isPending ? '読み込んでいます…' : null}
        </p>
      )}
    </aside>
  )
}
