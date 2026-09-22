import { useQueries } from '@tanstack/react-query'
import { ArrowUpRight, Check, X } from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { FieldMeta, MetaResponse, ObjectMeta, References, RefRecord, Row, Scalar } from '@/api/types'
import { Avatar, ObjectIcon, Tag } from '@/components/ui/basics'
import { ChoiceList, type Choice } from '@/components/ui/ChoiceList'
import { Popover } from '@/components/ui/overlay'
import { keys } from '@/data/queries'
import { cx } from '@/lib/cx'
import { formatNumber, formatPercent, formatYen } from '@/lib/format'
import { isEmptyValue, refFor } from '@/lib/records'
import { useDebounced } from '@/lib/useDebounced'
import { usePeek } from '@/lib/usePeek'
import { FieldValue } from './FieldValue'
import { DriveFilesEditor } from './DriveFilesEditor'
import { RichTextEditorLazy, RichTextView } from './RichText'

export type Commit = (patch: Record<string, Scalar>, refs?: References) => void

interface EditorProps {
  meta: MetaResponse
  object: ObjectMeta
  field: FieldMeta
  row: Row
  references: References
  onCommit: Commit
  /** form = 枠のある入力欄(新規作成) / inline = 触るまで文字に見える入力欄(パネル) */
  variant?: 'form' | 'inline'
  autoFocus?: boolean
}

const controlCls = (variant: 'form' | 'inline') =>
  cx(
    'min-h-8 w-full min-w-0 rounded-md px-2 text-base text-ink outline-none transition-shadow duration-100 placeholder:text-ink-3',
    'focus:bg-paper focus:shadow-[inset_0_0_0_1.5px_var(--accent)]',
    variant === 'form' ? 'bg-paper shadow-[inset_0_0_0_1px_var(--line-strong)]' : 'bg-transparent hover:bg-sunken',
  )

// ---------------------------------------------------------------------------
// 文字・数値の入力。確定は Enter かフォーカスが外れたとき。Esc で元に戻す
// ---------------------------------------------------------------------------

const NUMERIC = new Set(['number', 'currency', 'percent'])

function parseNumber(text: string): number | null {
  const cleaned = text.normalize('NFKC').replace(/[¥,\s%円]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** 数値は、触っていないあいだは桁区切り(と ¥ / %)で見せ、触ると素の数字にする */
function formatNumeric(field: FieldMeta, text: string): string {
  const n = Number(text)
  if (text === '' || !Number.isFinite(n)) return text
  if (field.type === 'currency') return formatYen(n)
  if (field.type === 'percent') return formatPercent(n, field.scale)
  return formatNumber(n, field.scale)
}

function TextEditor({ field, row, onCommit, variant = 'inline', autoFocus }: EditorProps) {
  const numeric = NUMERIC.has(field.type)
  const initial = row[field.key] === null || row[field.key] === undefined ? '' : String(row[field.key])
  const [draft, setDraft] = useState(initial)
  const [synced, setSynced] = useState(initial)
  const [editing, setEditing] = useState(false)
  if (synced !== initial) {
    // 外から値が変わった(楽観更新の確定、別の場所での編集)ら、入力中でなければ追従する
    setSynced(initial)
    setDraft(initial)
  }

  const commit = () => {
    const next: Scalar = numeric ? parseNumber(draft) : draft.trim() || null
    const current = row[field.key] ?? null
    if (next !== current) onCommit({ [field.key]: next })
    if (numeric) setDraft(next === null ? '' : String(next))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      setDraft(initial)
      requestAnimationFrame(() => (e.target as HTMLElement).blur())
    } else if (e.key === 'Enter' && (field.type !== 'textarea' || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      ;(e.target as HTMLElement).blur()
    }
  }

  if (field.type === 'textarea') {
    return (
      <textarea
        value={draft}
        autoFocus={autoFocus}
        rows={2}
        maxLength={field.max_length}
        placeholder={field.placeholder ?? (variant === 'inline' ? '未入力' : undefined)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={cx(controlCls(variant), 'resize-none py-1.5 leading-[1.375rem] [field-sizing:content]')}
      />
    )
  }
  return (
    <input
      value={numeric && !editing ? formatNumeric(field, draft) : draft}
      autoFocus={autoFocus}
      type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : field.type === 'phone' ? 'tel' : 'text'}
      inputMode={numeric ? (field.scale ? 'decimal' : 'numeric') : undefined}
      maxLength={numeric ? undefined : field.max_length}
      placeholder={field.placeholder ?? (variant === 'inline' ? '未入力' : undefined)}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false)
        commit()
      }}
      onKeyDown={onKeyDown}
      className={cx(controlCls(variant), 'h-8', numeric && 'tabular-nums')}
    />
  )
}

/** 書式付きの文字。パネルでは、押すまで文字として見せる(エディタは重いので、要るときだけ読む) */
function RichTextField({ field, row, onCommit, variant = 'inline', autoFocus }: EditorProps) {
  const value = typeof row[field.key] === 'string' ? String(row[field.key]) : null
  const [open, setOpen] = useState(variant === 'form')
  const draft = useRef<string | null>(value)
  const commit = () => {
    if (draft.current !== value) onCommit({ [field.key]: draft.current })
    if (variant === 'inline') setOpen(false)
  }
  if (!open) {
    return (
      <button
        type="button"
        aria-label={field.label}
        onClick={() => setOpen(true)}
        className={cx(controlCls('inline'), 'min-h-8 py-1.5 text-left', !value && 'text-ink-3')}
      >
        {value ? <RichTextView html={value} /> : (field.placeholder ?? '未入力')}
      </button>
    )
  }
  return (
    <RichTextEditorLazy
      value={value}
      variant={variant}
      autoFocus={autoFocus || variant === 'inline'}
      placeholder={field.placeholder}
      minHeight={variant === 'form' ? '5.5rem' : '3rem'}
      onChange={(html) => (draft.current = html)}
      onBlur={commit}
      onSubmit={commit}
      onCancel={() => {
        draft.current = value
        if (variant === 'inline') setOpen(false)
      }}
    />
  )
}

function DateEditor({ field, row, onCommit, variant = 'inline', autoFocus }: EditorProps) {
  const value = typeof row[field.key] === 'string' ? String(row[field.key]).slice(0, 10) : ''
  return (
    <div className="group/date relative flex items-center">
      <input
        type="date"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onCommit({ [field.key]: e.target.value || null })}
        className={cx(controlCls(variant), 'h-8 tabular-nums', !value && 'text-ink-3')}
      />
      {value && !field.required && (
        <button
          type="button"
          aria-label={`${field.label}を空にする`}
          onClick={() => onCommit({ [field.key]: null })}
          className="absolute right-8 grid size-5 place-items-center rounded text-ink-3 opacity-0 group-hover/date:opacity-100 hover:bg-sunken hover:text-ink focus-visible:opacity-100"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 選ぶ系(選択肢・利用者・関連レコード)。ボタンを押すとポップオーバーが開く
// ---------------------------------------------------------------------------

function PickerButton({
  variant,
  empty,
  label,
  autoFocus,
  onOpen,
  children,
}: {
  variant: 'form' | 'inline'
  empty: boolean
  label: string
  autoFocus?: boolean
  onOpen: (el: HTMLElement) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      aria-label={label}
      aria-haspopup="listbox"
      onClick={(e) => onOpen(e.currentTarget)}
      className={cx(controlCls(variant), 'flex h-8 items-center text-left', empty && 'text-ink-3')}
    >
      {empty ? (variant === 'inline' ? '未設定' : label) : children}
    </button>
  )
}

function SelectEditor(props: EditorProps) {
  const { field, row, onCommit, variant = 'inline' } = props
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [query, setQuery] = useState('')
  const options = field.options ?? []
  const filterable = options.length > 7
  const visible = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
  const close = () => {
    setAnchor(null)
    setQuery('')
  }
  return (
    <>
      <PickerButton variant={variant} empty={isEmptyValue(field, row)} label={field.label} autoFocus={props.autoFocus} onOpen={setAnchor}>
        <FieldValue {...props} />
      </PickerButton>
      {anchor && (
        <Popover anchor={anchor} onClose={close} width={Math.max(200, anchor.offsetWidth)}>
          <ChoiceList
            query={filterable ? query : undefined}
            onQuery={filterable ? setQuery : undefined}
            placeholder={`${field.label}を探す`}
            choices={visible.map((o) => ({
              id: o.value,
              node: <Tag color={o.color}>{o.label}</Tag>,
              searchText: o.label,
              selected: row[field.key] === o.value,
              commit: () => {
                onCommit({ [field.key]: o.value })
                close()
              },
            }))}
            clear={
              !field.required && !isEmptyValue(field, row)
                ? () => {
                    onCommit({ [field.key]: null })
                    close()
                  }
                : undefined
            }
          />
        </Popover>
      )}
    </>
  )
}

/** 複数選択。押すたびに付け外し、一覧は開いたまま。値は選択肢の value の配列(JSON) */
function MultiSelectEditor(props: EditorProps) {
  const { field, row, onCommit, variant = 'inline' } = props
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [query, setQuery] = useState('')
  const options = field.options ?? []
  const current = ((): Scalar[] => {
    try {
      const parsed = JSON.parse(String(row[field.key] ?? '[]')) as unknown
      return Array.isArray(parsed) ? (parsed as Scalar[]) : []
    } catch {
      return []
    }
  })()
  const write = (next: Scalar[]) => onCommit({ [field.key]: next.length ? JSON.stringify(next) : null })
  const filterable = options.length > 7
  const visible = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
  return (
    <>
      <PickerButton variant={variant} empty={current.length === 0} label={field.label} autoFocus={props.autoFocus} onOpen={setAnchor}>
        <FieldValue {...props} />
      </PickerButton>
      {anchor && (
        <Popover anchor={anchor} onClose={() => {
            setAnchor(null)
            setQuery('')
          }} width={Math.max(220, anchor.offsetWidth)}>
          <ChoiceList
            query={filterable ? query : undefined}
            onQuery={filterable ? setQuery : undefined}
            placeholder={`${field.label}を探す`}
            choices={visible.map((o) => ({
              id: o.value,
              node: <Tag color={o.color}>{o.label}</Tag>,
              searchText: o.label,
              selected: current.includes(o.value),
              commit: () => write(current.includes(o.value) ? current.filter((v) => v !== o.value) : [...current, o.value]),
            }))}
            clear={current.length > 0 ? () => write([]) : undefined}
          />
          <p className="border-t border-line px-3 py-2 text-xs text-ink-3">押すたびに付け外し。Esc で閉じる</p>
        </Popover>
      )}
    </>
  )
}

function UserEditor(props: EditorProps) {
  const { meta, field, row, onCommit, variant = 'inline' } = props
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <PickerButton variant={variant} empty={isEmptyValue(field, row)} label={field.label} autoFocus={props.autoFocus} onOpen={setAnchor}>
        <FieldValue {...props} />
      </PickerButton>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={Math.max(200, anchor.offsetWidth)}>
          <ChoiceList
            choices={meta.users.map((u) => ({
              id: u.id,
              node: (
                <>
                  <Avatar name={u.name} color={u.avatar_color} size={18} />
                  <span className="truncate">{u.name}</span>
                </>
              ),
              searchText: u.name,
              selected: row[field.key] === u.id,
              commit: () => {
                onCommit({ [field.key]: u.id })
                setAnchor(null)
              },
            }))}
            clear={
              !field.required && !isEmptyValue(field, row)
                ? () => {
                    onCommit({ [field.key]: null })
                    setAnchor(null)
                  }
                : undefined
            }
          />
        </Popover>
      )}
    </>
  )
}

/** 関連レコードを検索して選ぶ。polymorphic(関連先)は複数のテーブルをまとめて探す */
function RelationEditor(props: EditorProps) {
  const { meta, field, row, onCommit, variant = 'inline' } = props
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [query, setQuery] = useState('')
  const q = useDebounced(query, 120)
  const targets = useMemo(
    () => (field.type === 'polymorphic' ? (field.targets ?? []) : field.target ? [field.target] : []),
    [field],
  )

  const results = useQueries({
    queries: targets.map((target) => {
      const targetMeta = meta.objects.find((o) => o.key === target)
      const params = { q, limit: targets.length > 1 ? 5 : 8, sort: [{ field: 'updated_at', dir: 'desc' as const }] }
      return {
        queryKey: keys.records(target, params),
        queryFn: () => api.listRecords(target, params),
        enabled: anchor !== null && Boolean(targetMeta),
      }
    }),
  })

  const currentId = field.type === 'polymorphic' && field.columns ? row[field.columns.id] : row[field.key]
  const close = () => {
    setAnchor(null)
    setQuery('')
  }

  const choices: Choice[] = targets.flatMap((target, i) => {
    const targetMeta = meta.objects.find((o) => o.key === target)
    if (!targetMeta) return []
    return (results[i]?.data?.records ?? []).map((r) => {
      const name = String(r[targetMeta.name_field] ?? '')
      const ref: RefRecord = { id: r.id, name }
      return {
        id: `${target}:${r.id}`,
        node: (
          <>
            <ObjectIcon icon={targetMeta.icon} color={targetMeta.color} size={12} />
            <span className="truncate">{name}</span>
            {targets.length > 1 && <span className="ml-auto flex-none text-xs text-ink-3">{targetMeta.label}</span>}
          </>
        ),
        searchText: name,
        selected: r.id === currentId,
        commit: () => {
          const patch =
            field.type === 'polymorphic' && field.columns
              ? { [field.columns.object]: target, [field.columns.id]: r.id }
              : { [field.key]: r.id }
          onCommit(patch, { [target]: { [r.id]: ref } })
          close()
        },
      }
    })
  })

  const targetLabels = targets.map((t) => meta.objects.find((o) => o.key === t)?.label ?? t).join('・')
  // パネルの中では、指しているレコードへ進める(押すと選び直し、右端の矢印で開く)
  const { openPeek } = usePeek()
  const linked = variant === 'inline' ? refFor(field, row, props.references) : null
  return (
    <>
      <div className="group/rel relative">
        <PickerButton variant={variant} empty={isEmptyValue(field, row)} label={field.label} autoFocus={props.autoFocus} onOpen={setAnchor}>
          <span className={cx('flex min-w-0', linked && 'pr-7')}>
            <FieldValue {...props} onOpenRecord={undefined} />
          </span>
        </PickerButton>
        {linked && linked.object !== 'users' && (
          <button
            type="button"
            aria-label={`「${linked.ref.name}」を開く`}
            title={`「${linked.ref.name}」を開く`}
            onClick={() => openPeek(linked.object, linked.ref.id)}
            className="absolute top-1 right-1 grid size-6 place-items-center rounded text-ink-3 opacity-0 group-focus-within/rel:opacity-100 group-hover/rel:opacity-100 hover:bg-paper hover:text-ink [@media(hover:none)]:opacity-100"
          >
            <ArrowUpRight size={14} aria-hidden />
          </button>
        )}
      </div>
      {anchor && (
        <Popover anchor={anchor} onClose={close} width={Math.max(300, anchor.offsetWidth)}>
          <ChoiceList
            query={query}
            onQuery={setQuery}
            placeholder={`${targetLabels}を探す`}
            loading={results.some((r) => r.isLoading)}
            choices={choices}
            clear={
              !field.required && !isEmptyValue(field, row)
                ? () => {
                    onCommit(
                      field.type === 'polymorphic' && field.columns
                        ? { [field.columns.object]: null, [field.columns.id]: null }
                        : { [field.key]: null },
                    )
                    close()
                  }
                : undefined
            }
          />
        </Popover>
      )}
    </>
  )
}

function CheckboxEditor({ field, row, onCommit }: EditorProps) {
  const checked = Boolean(row[field.key])
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={field.label}
      onClick={() => onCommit({ [field.key]: !checked })}
      className={cx(
        'ml-2 grid size-[18px] place-items-center rounded-[5px] border-[1.5px]',
        checked ? 'border-accent bg-accent text-on-accent' : 'border-line-strong hover:border-ink-3',
      )}
    >
      {checked && <Check size={12} strokeWidth={3} aria-hidden />}
    </button>
  )
}

export function FieldEditor(props: EditorProps) {
  switch (props.field.type) {
    case 'select':
      return <SelectEditor {...props} />
    case 'multi_select':
      return <MultiSelectEditor {...props} />
    case 'user':
      return <UserEditor {...props} />
    case 'relation':
    case 'polymorphic':
      return <RelationEditor {...props} />
    case 'date':
      return <DateEditor {...props} />
    case 'checkbox':
      return <CheckboxEditor {...props} />
    case 'richtext':
      return <RichTextField {...props} />
    case 'drive_files':
      return <DriveFilesEditor object={props.object} field={props.field} row={props.row} onCommit={props.onCommit} />
    default:
      return <TextEditor {...props} />
  }
}
