import { Check, ExternalLink } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { FieldMeta, MetaResponse, ObjectMeta, References, RefRecord, Row } from '@/api/types'
import { Avatar, ObjectIcon, Tag } from '@/components/ui/basics'
import { cx } from '@/lib/cx'
import { dueTone, formatDateTime, formatDue } from '@/lib/dates'
import { formatNumber, formatPercent, formatYen } from '@/lib/format'
import { isClosed, optionOf, refFor } from '@/lib/records'

/** 別レコードへのリンク。押すと右のパネルでそのレコードを開く */
export function RecordChip({
  meta,
  object,
  record,
  onOpen,
}: {
  meta: MetaResponse
  object: string
  record: RefRecord
  onOpen?: (object: string, id: string) => void
}) {
  const target = meta.objects.find((o) => o.key === object)
  const body = (
    <>
      {target && <ObjectIcon icon={target.icon} color={target.color} size={12} />}
      <span className="truncate">{record.name}</span>
    </>
  )
  if (!onOpen) return <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">{body}</span>
  return (
    <button
      type="button"
      className="-mx-1 inline-flex max-w-full min-w-0 items-center gap-1.5 rounded px-1 text-left decoration-line-strong underline-offset-4 hover:bg-sunken hover:underline"
      onClick={(e: MouseEvent) => {
        e.stopPropagation()
        onOpen(object, record.id)
      }}
    >
      {body}
    </button>
  )
}

const stop = (e: MouseEvent) => e.stopPropagation()

/** 列の値を型に応じて表示する。一覧のセル・カンバンのカード・パネルの 3 か所で使う */
export function FieldValue({
  meta,
  object,
  field,
  row,
  references,
  onOpenRecord,
}: {
  meta: MetaResponse
  object: ObjectMeta
  field: FieldMeta
  row: Row
  references: References
  onOpenRecord?: (object: string, id: string) => void
}) {
  if (field.type === 'relation' || field.type === 'polymorphic') {
    const hit = refFor(field, row, references)
    return hit ? <RecordChip meta={meta} object={hit.object} record={hit.ref} onOpen={onOpenRecord} /> : null
  }
  if (field.type === 'user') {
    const user = meta.users.find((u) => u.id === row[field.key])
    return user ? (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <Avatar name={user.name} color={user.avatar_color} size={18} />
        <span className="truncate">{user.name}</span>
      </span>
    ) : null
  }

  const value = row[field.key]
  if (value === null || value === undefined || value === '') return null

  switch (field.type) {
    case 'select': {
      const option = optionOf(field, value)
      return option ? <Tag color={option.color}>{option.label}</Tag> : <span>{String(value)}</span>
    }
    case 'currency':
      return <span className="tabular-nums">{formatYen(Number(value))}</span>
    case 'number':
      return <span className="tabular-nums">{formatNumber(Number(value))}</span>
    case 'percent':
      return <span className="tabular-nums">{formatPercent(Number(value))}</span>
    case 'date': {
      const iso = String(value)
      const tone = field.semantic === 'deadline' && !isClosed(object, row) ? dueTone(iso) : 'later'
      return (
        <span className={cx('whitespace-nowrap', tone === 'overdue' && 'text-danger', tone === 'today' && 'font-bold text-accent-ink')}>
          {formatDue(iso)}
        </span>
      )
    }
    case 'datetime':
      return <span className="whitespace-nowrap text-ink-2">{formatDateTime(String(value))}</span>
    case 'checkbox':
      return value ? <Check size={15} className="text-accent" aria-label="はい" /> : null
    case 'email':
      return (
        <a href={`mailto:${String(value)}`} onClick={stop} className="truncate underline-offset-4 hover:underline">
          {String(value)}
        </a>
      )
    case 'phone':
      return (
        <a href={`tel:${String(value)}`} onClick={stop} className="tabular-nums underline-offset-4 hover:underline">
          {String(value)}
        </a>
      )
    case 'url':
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noreferrer"
          onClick={stop}
          className="inline-flex min-w-0 items-center gap-1 underline-offset-4 hover:underline"
        >
          <span className="truncate">{String(value).replace(/^https?:\/\//, '')}</span>
          <ExternalLink size={12} className="flex-none text-ink-3" aria-hidden />
        </a>
      )
    default:
      return <span className="truncate">{String(value)}</span>
  }
}
