import { Check, ExternalLink } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { FieldMeta, MetaResponse, ObjectMeta, References, RefRecord, Row, Scalar } from '@/api/types'
import { Avatar, ObjectIcon, Tag } from '@/components/ui/basics'
import { cx } from '@/lib/cx'
import { dueTone, formatDateTime, formatDue } from '@/lib/dates'
import { formatNumber, formatPercent, formatYen } from '@/lib/format'
import { isClosed, optionOf, refFor } from '@/lib/records'
import { driveKind, parseDriveFiles } from '@/lib/drive'
import { plainText } from '@/lib/richtext'

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

/**
 * 列の値を型に応じて表示する。一覧のセル・カンバンのカード・パネルの 3 か所で使う。
 * 幅が足りなければ … で省く(置かれた場所の端からはみ出さない)
 */
export function FieldValue({
  meta,
  object,
  field,
  row,
  references,
  onOpenRecord,
  singleLine,
}: {
  meta: MetaResponse
  object: ObjectMeta
  field: FieldMeta
  row: Row
  references: References
  onOpenRecord?: (object: string, id: string) => void
  /** 一覧のセル: 複数選択を折り返さず 1 行に並べ、入りきらない分は端で切る */
  singleLine?: boolean
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
    case 'multi_select': {
      const values = ((): Scalar[] => {
        try {
          const parsed = JSON.parse(String(value)) as unknown
          return Array.isArray(parsed) ? (parsed as Scalar[]) : []
        } catch {
          return []
        }
      })()
      if (values.length === 0) return null
      return (
        <span className={cx('flex min-w-0 gap-1', singleLine ? 'overflow-hidden' : 'flex-wrap')}>
          {values.map((v) => {
            const option = optionOf(field, v)
            return option ? (
              <Tag key={String(v)} color={option.color} className={cx(singleLine && 'flex-none')}>
                {option.label}
              </Tag>
            ) : null
          })}
        </span>
      )
    }
    case 'select': {
      const option = optionOf(field, value)
      return option ? <Tag color={option.color}>{option.label}</Tag> : <span>{String(value)}</span>
    }
    case 'currency':
      return <span className="truncate tabular-nums">{formatYen(Number(value))}</span>
    case 'number':
      return <span className="truncate tabular-nums">{formatNumber(Number(value), field.scale)}</span>
    case 'percent':
      return <span className="truncate tabular-nums">{formatPercent(Number(value), field.scale)}</span>
    case 'date': {
      const iso = String(value)
      const tone = field.semantic === 'deadline' && !isClosed(object, row) ? dueTone(iso) : 'later'
      return (
        <span className={cx('truncate', tone === 'overdue' && 'text-danger', tone === 'today' && 'font-bold text-accent-ink')}>
          {formatDue(iso)}
        </span>
      )
    }
    case 'datetime':
      return <span className="truncate text-ink-2">{formatDateTime(String(value))}</span>
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
        <a href={`tel:${String(value)}`} onClick={stop} className="truncate tabular-nums underline-offset-4 hover:underline">
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
    case 'drive_files': {
      // 一覧では、印を並べて件数が分かるように。名前は最初の 1 つだけ
      const files = parseDriveFiles(value)
      if (files.length === 0) return null
      return (
        <span className="inline-flex min-w-0 items-center gap-1">
          {files.slice(0, 3).map((f) => {
            const kind = driveKind(f.mime_type)
            return (
              <span key={f.id} className="grid size-5 flex-none place-items-center rounded" style={{ background: `var(--tag-${kind.color}-bg)`, color: `var(--tag-${kind.color}-ink)` }} title={f.name}>
                <kind.icon size={12} aria-hidden />
              </span>
            )
          })}
          <span className="truncate">{files.length === 1 ? files[0].name : `${files.length} 件`}</span>
        </span>
      )
    }
    case 'richtext':
      // 一覧では書式を落として 1 行に
      return <span className="truncate">{plainText(String(value))}</span>
    default:
      return <span className="truncate">{String(value)}</span>
  }
}
