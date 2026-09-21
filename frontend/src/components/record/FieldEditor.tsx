import { useQueries } from '@tanstack/react-query'
import { Check, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { FieldMeta, MetaResponse, ObjectMeta, References, RefRecord, Row, Scalar } from '@/api/types'
import { Avatar, ObjectIcon, Tag } from '@/components/ui/basics'
import { Popover } from '@/components/ui/overlay'
import { keys } from '@/data/queries'
import { cx } from '@/lib/cx'
import { isEmptyValue } from '@/lib/records'
import { useDebounced } from '@/lib/useDebounced'
import { FieldValue } from './FieldValue'

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

function TextEditor({ field, row, onCommit, variant = 'inline', autoFocus }: EditorProps) {
  const numeric = NUMERIC.has(field.type)
  const initial = row[field.key] === null || row[field.key] === undefined ? '' : String(row[field.key])
  const [draft, setDraft] = useState(initial)
  const [synced, setSynced] = useState(initial)
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
      value={draft}
      autoFocus={autoFocus}
      type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : field.type === 'phone' ? 'tel' : 'text'}
      inputMode={numeric ? 'numeric' : undefined}
      placeholder={field.placeholder ?? (variant === 'inline' ? '未入力' : undefined)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className={cx(controlCls(variant), 'h-8', numeric && 'tabular-nums')}
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

interface Choice {
  id: string
  node: ReactNode
  searchText: string
  selected: boolean
  commit: () => void
}

/** 矢印キーで動かして Enter で決める一覧。候補が多いときは上に絞り込み欄を出す */
function ChoiceList({
  choices,
  query,
  onQuery,
  placeholder,
  loading,
  clear,
}: {
  choices: Choice[]
  query?: string
  onQuery?: (q: string) => void
  placeholder?: string
  loading?: boolean
  clear?: () => void
}) {
  const [active, setActive] = useState(() => Math.max(0, choices.findIndex((c) => c.selected)))
  const listRef = useRef<HTMLDivElement>(null)
  const index = Math.min(active, Math.max(0, choices.length - 1))

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  // 絞り込み欄が無いときは一覧そのものにフォーカスを当て、矢印キーを受ける
  const hasQuery = Boolean(onQuery)
  useEffect(() => {
    if (!hasQuery) listRef.current?.focus({ preventScroll: true })
  }, [hasQuery])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((index + 1) % Math.max(1, choices.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((index - 1 + choices.length) % Math.max(1, choices.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choices[index]?.commit()
    }
  }

  return (
    <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
      {onQuery ? (
        <label className="flex flex-none items-center gap-2 border-b border-line px-3">
          <Search size={14} className="flex-none text-ink-3" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              onQuery(e.target.value)
              setActive(0)
            }}
            placeholder={placeholder}
            className="h-9 w-full bg-transparent text-base outline-none placeholder:text-ink-3"
          />
        </label>
      ) : null}
      <div
        ref={listRef}
        role="listbox"
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto p-1 outline-none"
      >
        {choices.map((c, i) => (
          <button
            key={c.id}
            type="button"
            role="option"
            aria-selected={c.selected}
            data-active={i === index}
            tabIndex={-1}
            onPointerMove={() => setActive(i)}
            onClick={c.commit}
            className={cx(
              'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left',
              i === index && 'bg-sunken',
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">{c.node}</span>
            {c.selected && <Check size={14} className="flex-none text-accent" aria-hidden />}
          </button>
        ))}
        {choices.length === 0 && (
          <p className="px-2 py-3 text-sm text-ink-3">{loading ? '探しています…' : '当てはまるものがありません'}</p>
        )}
      </div>
      {clear && (
        <button
          type="button"
          onClick={clear}
          className="flex h-9 flex-none items-center gap-2 border-t border-line px-3 text-left text-sm text-ink-2 hover:bg-sunken"
        >
          <X size={13} aria-hidden />
          空にする
        </button>
      )}
    </div>
  )
}

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
  return (
    <>
      <PickerButton variant={variant} empty={isEmptyValue(field, row)} label={field.label} autoFocus={props.autoFocus} onOpen={setAnchor}>
        <FieldValue {...props} onOpenRecord={undefined} />
      </PickerButton>
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
    case 'user':
      return <UserEditor {...props} />
    case 'relation':
    case 'polymorphic':
      return <RelationEditor {...props} />
    case 'date':
      return <DateEditor {...props} />
    case 'checkbox':
      return <CheckboxEditor {...props} />
    default:
      return <TextEditor {...props} />
  }
}
