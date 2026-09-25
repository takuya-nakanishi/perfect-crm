import { DragDropProvider, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/react'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import type { FieldMeta, KanbanViewConfig, MetaResponse, ObjectMeta, References, Row, SelectOption } from '@/api/types'
import { FieldValue } from '@/components/record/FieldValue'
import { TaskCheck } from '@/components/record/TaskCheck'
import { IconButton, Tag } from '@/components/ui/basics'
import { useUpdateRecord } from '@/data/mutations'
import { useRecords } from '@/data/queries'
import { useCompletion } from '@/data/useCompletion'
import { cx } from '@/lib/cx'
import { clickableSensors } from '@/lib/dnd'
import { formatYenCompact } from '@/lib/format'
import { fieldOf, isEmptyValue, recordName } from '@/lib/records'
import { usePeek } from '@/lib/usePeek'
import { useUI } from '@/state/ui'
import { EmptyState } from './EmptyState'

const UNSET = '__unset__'

interface CardContext {
  meta: MetaResponse
  object: ObjectMeta
  fields: FieldMeta[]
  references: References
}

function CardBody({ ctx, row, checked, onToggle }: { ctx: CardContext; row: Row; checked?: boolean; onToggle?: () => void }) {
  const { openPeek } = usePeek()
  const visible = ctx.fields.filter((f) => !isEmptyValue(f, row))
  return (
    <>
      <div className="flex items-start gap-2">
        {ctx.object.completion && onToggle && (
          <span className="mt-0.5">
            <TaskCheck meta={ctx.object} row={row} checked={Boolean(checked)} onToggle={onToggle} />
          </span>
        )}
        <p className={cx('min-w-0 flex-1 leading-snug text-ink', checked && 'text-ink-3 line-through')}>{recordName(ctx.object, row)}</p>
      </div>
      {visible.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
          {visible.map((f) => (
            <span key={f.key} className="inline-flex max-w-full min-w-0 items-center" title={f.label}>
              <FieldValue meta={ctx.meta} object={ctx.object} field={f} row={row} references={ctx.references} onOpenRecord={openPeek} />
            </span>
          ))}
        </div>
      )}
    </>
  )
}

function Card({
  ctx,
  row,
  active,
  leaving,
  checked,
  onToggle,
}: {
  ctx: CardContext
  row: Row
  active: boolean
  leaving: boolean
  checked: boolean
  onToggle: () => void
}) {
  const { openPeek } = usePeek()
  const { ref, isDragSource } = useDraggable({ id: row.id, data: { row } })
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      onClick={() => openPeek(ctx.object.key, row.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) openPeek(ctx.object.key, row.id)
      }}
      className={cx(
        'cursor-grab rounded-lg bg-raised p-3 shadow-card transition-shadow duration-100 select-none hover:shadow-[0_0_0_1px_var(--line-strong),0_2px_6px_rgb(24_32_27/0.08)] active:cursor-grabbing',
        active && 'shadow-[0_0_0_1.5px_var(--accent)]',
        isDragSource && 'opacity-35',
        leaving && 'row-leaving',
      )}
    >
      <CardBody ctx={ctx} row={row} checked={checked} onToggle={onToggle} />
    </div>
  )
}

function Column({
  ctx,
  option,
  rows,
  sumField,
  groupField,
  activeId,
  completion,
}: {
  ctx: CardContext
  option: SelectOption | null
  rows: Row[]
  sumField?: string
  groupField: FieldMeta
  activeId: string | null
  completion: ReturnType<typeof useCompletion>
}) {
  const value = option?.value ?? UNSET
  const { ref, isDropTarget } = useDroppable({ id: `column:${value}`, data: { value } })
  const openCreate = useUI((s) => s.openCreate)
  const openQuickAdd = useUI((s) => s.openQuickAdd)
  const sum = sumField ? rows.reduce((t, r) => t + (typeof r[sumField] === 'number' ? (r[sumField] as number) : 0), 0) : null

  return (
    <section
      ref={ref}
      aria-label={option?.label ?? '未設定'}
      className={cx(
        'flex max-h-full w-[288px] flex-none flex-col rounded-xl bg-chrome transition-shadow duration-100',
        isDropTarget && 'shadow-[inset_0_0_0_1.5px_var(--accent)]',
      )}
    >
      <header className="flex h-11 flex-none items-center gap-2 pr-1.5 pl-3">
        {option ? <Tag color={option.color}>{option.label}</Tag> : <span className="text-ink-2">未設定</span>}
        <span className="text-sm text-ink-3 tabular-nums">{rows.length}</span>
        {sum !== null && sum > 0 && <span className="ml-auto text-sm text-ink-2 tabular-nums">{formatYenCompact(sum)}</span>}
        <IconButton
          label={`${option?.label ?? '未設定'}に追加`}
          className={cx(sum !== null && sum > 0 ? '' : 'ml-auto')}
          onClick={() =>
            ctx.object.completion && !option
              ? openQuickAdd()
              : openCreate(ctx.object.key, option ? { [groupField.key]: option.value } : {})
          }
        >
          <Plus size={15} />
        </IconButton>
      </header>
      <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {rows.map((row) => (
          <Card
            key={row.id}
            ctx={ctx}
            row={row}
            active={row.id === activeId}
            leaving={completion.leaving.has(row.id)}
            checked={completion.isChecked(row)}
            onToggle={() => completion.complete(row)}
          />
        ))}
      </div>
    </section>
  )
}

export function KanbanView({
  meta,
  object,
  config,
  q,
  viewName,
}: {
  meta: MetaResponse
  object: ObjectMeta
  config: KanbanViewConfig
  q: string
  viewName: string
}) {
  const groupField = fieldOf(object, config.group_by)
  // 隠す列(完了済みなど)のレコードは、そもそも取りに行かない
  const filter = useMemo(() => {
    if (!config.hidden_groups?.length) return config.filter
    const hide = { field: config.group_by, op: 'not_in' as const, value: config.hidden_groups }
    return config.filter ? { and: [config.filter, hide] } : hide
  }, [config])
  const { data, isPending } = useRecords(object.key, { filter, sort: config.sort, q: q || undefined })
  const update = useUpdateRecord()
  const completion = useCompletion(object, filter)
  const { root: peek } = usePeek()

  const ctx: CardContext = useMemo(
    () => ({
      meta,
      object,
      fields: config.card_fields.map((k) => fieldOf(object, k)).filter((f): f is FieldMeta => Boolean(f)),
      references: data?.references ?? {},
    }),
    [meta, object, config.card_fields, data?.references],
  )

  if (!groupField?.options) return null
  const rows = data?.records ?? []
  if (!isPending && rows.length === 0) return <EmptyState object={object} viewName={viewName} filtered={Boolean(q)} />

  const options = groupField.options.filter((o) => !config.hidden_groups?.includes(o.value))
  const unset = rows.filter((r) => isEmptyValue(groupField, r))
  const activeId = peek?.object === object.key ? peek.id : null

  return (
    <DragDropProvider
      sensors={clickableSensors}
      onDragEnd={(event) => {
        if (event.canceled) return
        const { source, target } = event.operation
        const row = source?.data?.row as Row | undefined
        const value = target?.data?.value as string | undefined
        if (!row || value === undefined) return
        const next = value === UNSET ? null : value
        if ((row[groupField.key] ?? null) === next) return
        update.mutate({ object: object.key, id: row.id, patch: { [groupField.key]: next } })
      }}
    >
      <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto px-5 pt-3 pb-4">
        {options.map((option) => (
          <Column
            key={option.value}
            ctx={ctx}
            option={option}
            rows={rows.filter((r) => r[groupField.key] === option.value)}
            sumField={config.sum_field}
            groupField={groupField}
            activeId={activeId}
            completion={completion}
          />
        ))}
        {unset.length > 0 && (
          <Column ctx={ctx} option={null} rows={unset} sumField={config.sum_field} groupField={groupField} activeId={activeId} completion={completion} />
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {(source) => {
          const row = source.data?.row as Row | undefined
          return row ? (
            <div className="w-[272px] rotate-[1.5deg] cursor-grabbing rounded-lg bg-raised p-3 shadow-drag">
              <CardBody ctx={ctx} row={row} />
            </div>
          ) : null
        }}
      </DragOverlay>
    </DragDropProvider>
  )
}
