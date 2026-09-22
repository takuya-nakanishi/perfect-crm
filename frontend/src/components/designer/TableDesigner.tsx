import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, GripVertical, Plus, Trash2, X } from 'lucide-react'
import { createElement, useEffect, useMemo, useRef, useState, type ChangeEvent, type CompositionEvent, type KeyboardEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate } from 'react-router'
import { api, ApiError } from '@/api/client'
import type { FieldType, MetaResponse, SelectOption, TagColor } from '@/api/types'
import { Button, IconButton, Kbd, ObjectIcon, Tag } from '@/components/ui/basics'
import { ChoiceList } from '@/components/ui/ChoiceList'
import { Modal, Popover } from '@/components/ui/overlay'
import { findObject, homePath, keys } from '@/data/queries'
import { cx } from '@/lib/cx'
import { FIELD_TYPES, fieldType, OBJECT_ICON_NAMES, objectIcon } from '@/lib/icons'
import {
  autoFieldKey,
  autoTableKey,
  blankDraft,
  draftOf,
  isBlankRow,
  newField,
  newOption,
  SCALE_TYPES,
  TAG_COLOR_LABELS,
  TAG_COLORS,
  TEXT_TYPES,
  toInput,
  validateDraft,
  type DraftField,
  type TableDraft,
} from '@/lib/tableDraft'
import { useUI } from '@/state/ui'

/** 項目の表の列: 並べ替え | 項目名 | データ型 | 必須 | 桁数・設定 | 操作 */
const COLS = '28px minmax(180px, 1.5fr) minmax(156px, 1fr) 52px minmax(148px, 1fr) 64px'

const cellInput =
  'h-8 w-full min-w-0 rounded-md bg-transparent px-2 text-base text-ink outline-none transition-shadow duration-100 placeholder:text-ink-3 hover:bg-sunken focus:bg-paper focus:shadow-[inset_0_0_0_1.5px_var(--accent)] disabled:hover:bg-transparent'

const composing = (e: KeyboardEvent) => e.nativeEvent.isComposing

/**
 * 列名(英小文字)の欄。日本語 IME の変換中に値を書き換えると変換が途切れる(Shift+L の「L」を「l」に直した瞬間に
 * 仕切り直しになり「lleあ」のようになる)ので、変換中はそのまま持ち、確定したときと外れたときに整える
 */
const normalizeKey = (s: string) => s.normalize('NFKC').trim().toLowerCase()
function keyInputHandlers(set: (key: string) => void) {
  return {
    onChange: (e: ChangeEvent<HTMLInputElement>) => set((e.nativeEvent as InputEvent).isComposing ? e.target.value : normalizeKey(e.target.value)),
    onCompositionEnd: (e: CompositionEvent<HTMLInputElement>) => set(normalizeKey(e.currentTarget.value)),
    spellCheck: false,
    autoCapitalize: 'off',
  } as const
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items
  const next = [...items]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

// ---------------------------------------------------------------------------
// アイコンと色
// ---------------------------------------------------------------------------

function Swatches({ value, onChange }: { value: TagColor; onChange: (c: TagColor) => void }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="色">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={TAG_COLOR_LABELS[c]}
          title={TAG_COLOR_LABELS[c]}
          onClick={() => onChange(c)}
          className="grid size-6 place-items-center rounded-full"
          style={{ background: `var(--tag-${c}-bg)`, color: `var(--tag-${c}-ink)`, boxShadow: value === c ? `0 0 0 1.5px var(--tag-${c}-ink)` : undefined }}
        >
          {value === c ? <Check size={12} strokeWidth={3} aria-hidden /> : <span className="size-2.5 rounded-full bg-current" />}
        </button>
      ))}
    </div>
  )
}

function AppearancePicker({ draft, onChange }: { draft: TableDraft; onChange: (patch: Partial<TableDraft>) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <button
        type="button"
        aria-label="アイコンと色を変える"
        title="アイコンと色を変える"
        aria-haspopup="dialog"
        onClick={(e) => setAnchor(e.currentTarget)}
        className="flex-none rounded-lg p-1 hover:bg-sunken"
      >
        <ObjectIcon icon={draft.icon} color={draft.color} size={26} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={268}>
          <div className="border-b border-line p-3">
            <Swatches value={draft.color} onChange={(color) => onChange({ color })} />
          </div>
          <div className="grid grid-cols-7 gap-0.5 p-2" role="radiogroup" aria-label="アイコン">
            {OBJECT_ICON_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={draft.icon === name}
                aria-label={name}
                onClick={() => onChange({ icon: name })}
                className={cx('grid size-8 place-items-center rounded-md', draft.icon === name ? 'bg-accent-wash text-accent-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink')}
              >
                {createElement(objectIcon(name), { size: 16, 'aria-hidden': true })}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// 1 項目の行
// ---------------------------------------------------------------------------

interface RowActions {
  patch(uid: string, patch: Partial<DraftField>): void
  remove(uid: string): void
  /** この行の次へ進む。末尾なら新しい行を足す */
  next(uid: string): void
  shift(uid: string, delta: number): void
  toggle(uid: string, open?: boolean): void
}

function TypePicker({ field, onChange, onPicked }: { field: DraftField; onChange: (type: FieldType) => void; onPicked: (type: FieldType) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const current = fieldType(field.type)
  const fixed = !field.isNew || field.isName
  return (
    <>
      <button
        type="button"
        disabled={fixed}
        aria-label={`${field.label || '項目'}のデータ型`}
        aria-haspopup="listbox"
        title={fixed ? (field.isName ? 'レコードの表示名は文字(1 行)に固定です' : '作成した項目の型は変えられません') : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
        className={cx(cellInput, 'flex items-center gap-2 text-left', fixed && 'text-ink-2')}
      >
        <current.icon size={15} className="flex-none text-ink-2" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{current.label}</span>
        {!fixed && <ChevronDown size={13} className="flex-none text-ink-3" aria-hidden />}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={340}>
          <ChoiceList
            choices={FIELD_TYPES.filter((t) => t.type !== 'polymorphic').map((t) => ({
              id: t.type,
              node: (
                <>
                  <t.icon size={15} className="flex-none text-ink-2" aria-hidden />
                  <span className="flex-none">{t.label}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-3">{t.hint}</span>
                </>
              ),
              searchText: t.label,
              selected: t.type === field.type,
              commit: () => {
                // 先に描き終えてから(選択肢の欄が現れてから)、次に触る場所へフォーカスを送る
                flushSync(() => {
                  onChange(t.type)
                  setAnchor(null)
                })
                onPicked(t.type)
              },
            }))}
          />
        </Popover>
      )}
    </>
  )
}

function TargetPicker({ meta, field, onChange }: { meta: MetaResponse; field: DraftField; onChange: (target: string) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const target = findObject(meta, field.target ?? undefined)
  const body = target ? (
    <>
      <ObjectIcon icon={target.icon} color={target.color} size={12} />
      <span className="min-w-0 flex-1 truncate">{target.label}</span>
    </>
  ) : (
    <span className="min-w-0 flex-1 truncate text-ink-3">テーブルを選ぶ</span>
  )
  if (!field.isNew) return <div className="flex h-8 min-w-0 items-center gap-2 px-2 text-ink-2">{body}</div>
  return (
    <>
      <button
        type="button"
        data-target-picker
        aria-label={`${field.label || '項目'}の参照先`}
        aria-haspopup="listbox"
        onClick={(e) => setAnchor(e.currentTarget)}
        className={cx(cellInput, 'flex items-center gap-2 text-left')}
      >
        {body}
        <ChevronDown size={13} className="flex-none text-ink-3" aria-hidden />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={Math.max(220, anchor.offsetWidth)}>
          <ChoiceList
            choices={meta.objects.map((o) => ({
              id: o.key,
              node: (
                <>
                  <ObjectIcon icon={o.icon} color={o.color} size={12} />
                  <span className="truncate">{o.label}</span>
                </>
              ),
              searchText: o.label,
              selected: o.key === field.target,
              commit: () => {
                onChange(o.key)
                setAnchor(null)
              },
            }))}
          />
        </Popover>
      )}
    </>
  )
}

/** 桁数・設定の欄。型ごとに、その型で決めることだけを出す */
function SettingCell({ meta, field, actions }: { meta: MetaResponse; field: DraftField; actions: RowActions }) {
  const numberInput = (value: number | null, onValue: (n: number | null) => void, label: string, max: number, placeholder: string) => (
    <input
      value={value ?? ''}
      inputMode="numeric"
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => {
        const digits = e.target.value.normalize('NFKC').replace(/\D/g, '')
        onValue(digits === '' ? null : Math.min(max, Number(digits)))
      }}
      className={cx(cellInput, 'tabular-nums')}
    />
  )
  if (TEXT_TYPES.has(field.type) && field.type !== 'richtext') {
    return (
      <label className="flex items-center gap-1">
        {numberInput(field.max_length, (n) => actions.patch(field.uid, { max_length: n || null }), `${field.label || '項目'}の桁数`, 100000, '制限なし')}
        {/* 単位は、桁数を決めた行にだけ出す(ほとんどの行は「制限なし」なので、並ぶとうるさい) */}
        {field.max_length !== null && <span className="flex-none pr-1 text-sm text-ink-3">文字</span>}
      </label>
    )
  }
  if (SCALE_TYPES.has(field.type)) {
    return (
      <label className="flex items-center gap-1">
        <span className="flex-none pl-2 text-sm text-ink-3">小数</span>
        {numberInput(field.scale, (n) => actions.patch(field.uid, { scale: n }), `${field.label || '項目'}の小数の桁数`, 6, '0')}
        <span className="flex-none pr-1 text-sm text-ink-3">桁</span>
      </label>
    )
  }
  if (field.type === 'relation') return <TargetPicker meta={meta} field={field} onChange={(target) => actions.patch(field.uid, { target })} />
  if (field.type === 'select' || field.type === 'multi_select') {
    const named = field.options.filter((o) => o.label.trim())
    return (
      <button type="button" onClick={() => actions.toggle(field.uid)} className={cx(cellInput, 'flex items-center gap-1 text-left')}>
        {named.length === 0 && <span className="text-ink-3">選択肢を入れる</span>}
        {named.slice(0, 2).map((o) => (
          <Tag key={o.value} color={o.color} className="min-w-0">
            {o.label}
          </Tag>
        ))}
        {named.length > 2 && <span className="flex-none text-sm text-ink-3 tabular-nums">+{named.length - 2}</span>}
      </button>
    )
  }
  return <span className="px-2 text-ink-3">—</span>
}

function OptionsEditor({ field, onChange }: { field: DraftField; onChange: (options: SelectOption[]) => void }) {
  const [colorFor, setColorFor] = useState<{ value: string; anchor: HTMLElement } | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const focusAt = (index: number) => listRef.current?.querySelectorAll<HTMLInputElement>('input')[index]?.focus()
  const options = field.options
  const set = (value: string, patch: Partial<SelectOption>) => onChange(options.map((o) => (o.value === value ? { ...o, ...patch } : o)))
  /** 並びを変えてから、同期でフォーカスを移す(次のフレームを待つと、続けて打った文字が前の欄に入る) */
  const changeThenFocus = (next: SelectOption[], index: number) => {
    flushSync(() => onChange(next))
    focusAt(index)
  }
  const add = (at = options.length) => {
    const next = [...options]
    next.splice(at, 0, newOption(options))
    changeThenFocus(next, at)
  }

  return (
    <div>
      <ul ref={listRef} className="m-0 grid list-none gap-x-4 p-0 sm:grid-cols-2">
        {options.map((o, i) => (
          <li key={o.value} className="flex items-center gap-1">
            <button
              type="button"
              aria-label={`色(${TAG_COLOR_LABELS[o.color]})`}
              title="色を変える"
              onClick={(e) => setColorFor({ value: o.value, anchor: e.currentTarget })}
              className="grid size-7 flex-none place-items-center rounded-md hover:bg-sunken"
            >
              <span className="size-3 rounded-full" style={{ background: `var(--tag-${o.color}-ink)` }} />
            </button>
            <input
              value={o.label}
              aria-label={`選択肢 ${i + 1}`}
              placeholder="選択肢の名前"
              onChange={(e) => set(o.value, { label: e.target.value })}
              onKeyDown={(e) => {
                if (composing(e)) return
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  if (e.ctrlKey || e.metaKey) return e.currentTarget.form?.requestSubmit()
                  add(i + 1)
                } else if (e.key === 'Backspace' && o.label === '' && options.length > 1) {
                  e.preventDefault()
                  changeThenFocus(options.filter((x) => x.value !== o.value), Math.max(0, i - 1))
                } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                  e.preventDefault()
                  const to = i + (e.key === 'ArrowUp' ? -1 : 1)
                  changeThenFocus(move(options, i, to), Math.max(0, Math.min(options.length - 1, to)))
                }
              }}
              className={cellInput}
            />
            <IconButton label={`「${o.label || '選択肢'}」を外す`} onClick={() => onChange(options.filter((x) => x.value !== o.value))}>
              <X size={14} />
            </IconButton>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => add()} className="mt-1 inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm text-ink-2 hover:bg-sunken hover:text-ink">
        <Plus size={13} aria-hidden />
        選択肢を追加
      </button>
      {colorFor && (
        <Popover anchor={colorFor.anchor} onClose={() => setColorFor(null)}>
          <div className="p-2.5">
            <Swatches
              value={options.find((o) => o.value === colorFor.value)?.color ?? 'gray'}
              onChange={(color) => {
                set(colorFor.value, { color })
                setColorFor(null)
              }}
            />
          </div>
        </Popover>
      )}
    </div>
  )
}

function FieldDetail({ field, fields, actions }: { field: DraftField; fields: DraftField[]; actions: RowActions }) {
  const labelCls = 'flex h-8 items-center text-sm text-ink-2'
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1 border-t border-line bg-chrome py-3 pr-5 pl-[44px] sm:pl-[72px]">
      {(field.type === 'select' || field.type === 'multi_select') && (
        <>
          <span className={labelCls}>選択肢</span>
          <OptionsEditor field={field} onChange={(options) => actions.patch(field.uid, { options })} />
        </>
      )}
      {((TEXT_TYPES.has(field.type) && field.type !== 'richtext') || SCALE_TYPES.has(field.type) || field.type === 'currency') && (
        <>
          <label htmlFor={`${field.uid}-placeholder`} className={labelCls}>
            入力例
          </label>
          <input
            id={`${field.uid}-placeholder`}
            value={field.placeholder}
            placeholder="空の欄に薄く出す文字"
            onChange={(e) => actions.patch(field.uid, { placeholder: e.target.value })}
            className={cx(cellInput, 'max-w-sm')}
          />
        </>
      )}
      <label htmlFor={`${field.uid}-key`} className={labelCls}>
        列名
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3">
        <input
          id={`${field.uid}-key`}
          value={field.key}
          disabled={!field.isNew}
          {...keyInputHandlers((key) => actions.patch(field.uid, { key, keyTouched: true }))}
          onBlur={(e) => {
            const key = normalizeKey(e.currentTarget.value)
            actions.patch(field.uid, key ? { key } : { key: autoFieldKey(field.label, fields, field), keyTouched: false })
          }}
          className={cx(cellInput, 'max-w-56', !field.isNew && 'text-ink-2')}
        />
        <span className="text-sm text-ink-3">{field.isNew ? 'API と CSV で使う名前。作成後は変えられません' : '作成後は変えられません'}</span>
      </div>
    </div>
  )
}

interface FieldRowProps {
  meta: MetaResponse
  field: DraftField
  fields: DraftField[]
  expanded: boolean
  error?: string
  actions: RowActions
}

const rowCls = 'group/row border-b border-line bg-raised'

/** 並べ替えられる行。表示名の行は先頭に固定なので、こちらを通さず FixedFieldRow で描く */
function SortableFieldRow({ index, ...props }: FieldRowProps & { index: number }) {
  const { ref, handleRef, isDragSource } = useSortable({ id: props.field.uid, index })
  const label = props.field.label || '項目'
  return (
    <div ref={ref} data-field-row={props.field.uid} className={cx(rowCls, isDragSource && 'relative z-10 shadow-drag')}>
      <FieldRowBody
        {...props}
        sortable
        handle={
          <button
            ref={handleRef}
            type="button"
            aria-label={`「${label}」を並べ替える`}
            title="ドラッグで並べ替え(Alt + ↑↓)"
            className="grid h-8 cursor-grab place-items-center text-ink-3 opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:text-ink [@media(hover:none)]:opacity-100"
          >
            <GripVertical size={14} aria-hidden />
          </button>
        }
      />
    </div>
  )
}

function FixedFieldRow(props: FieldRowProps) {
  return (
    <div data-field-row={props.field.uid} className={rowCls}>
      <FieldRowBody {...props} handle={<span />} />
    </div>
  )
}

function FieldRowBody({ meta, field, fields, expanded, error, actions, handle, sortable }: FieldRowProps & { handle: ReactNode; sortable?: boolean }) {
  const removable = !field.isName && !field.isProtected
  return (
    <>
      <div className="grid items-center gap-x-1 pr-3 pl-1 sm:pl-8" style={{ gridTemplateColumns: COLS }}>
        {handle}
        <div className="flex min-w-0 items-center gap-1.5">
          <input
            data-name-input={field.uid}
            value={field.label}
            aria-label="項目名"
            aria-invalid={Boolean(error)}
            placeholder="項目名"
            onChange={(e) => {
              const label = e.target.value
              actions.patch(field.uid, { label, ...(field.isNew && !field.keyTouched ? { key: autoFieldKey(label, fields, field) } : null) })
            }}
            onKeyDown={(e) => {
              if (composing(e)) return
              if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault()
                actions.next(field.uid)
              } else if (e.key === 'Backspace' && isBlankRow(field)) {
                e.preventDefault()
                actions.remove(field.uid)
              } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && sortable) {
                e.preventDefault()
                actions.shift(field.uid, e.key === 'ArrowUp' ? -1 : 1)
              }
            }}
            className={cx(cellInput, field.isName && 'font-bold')}
          />
          {field.isName && (
            <span className="flex-none pr-1 text-sm text-ink-3" title="一覧やリンクに、レコードの名前として出る項目です">
              表示名
            </span>
          )}
        </div>
        <TypePicker
          field={field}
          onChange={(type) => {
            actions.patch(field.uid, { type })
            if (type === 'select' || type === 'multi_select') {
              if (field.options.length === 0) actions.patch(field.uid, { type, options: [newOption([])] })
              actions.toggle(field.uid, true)
            }
          }}
          onPicked={(type) => {
            // 型を選んだら、その型で次に決めること(選択肢の名前、参照先)へ進む
            const row = document.querySelector(`[data-field-row="${field.uid}"]`)
            if (type === 'select' || type === 'multi_select') row?.querySelector<HTMLElement>('ul input')?.focus()
            else if (type === 'relation') row?.querySelector<HTMLElement>('[data-target-picker]')?.focus()
          }}
        />
        <div className="grid place-items-center">
          <button
            type="button"
            role="checkbox"
            aria-checked={field.required || field.isName}
            aria-label={`${field.label || '項目'}を必須にする`}
            disabled={field.isName || field.type === 'checkbox'}
            onClick={() => actions.patch(field.uid, { required: !field.required })}
            className={cx(
              'grid size-[18px] place-items-center rounded-[5px] border-[1.5px] disabled:opacity-50',
              field.required || field.isName ? 'border-accent bg-accent text-on-accent' : 'border-line-strong hover:border-ink-3',
            )}
          >
            {(field.required || field.isName) && <Check size={12} strokeWidth={3} aria-hidden />}
          </button>
        </div>
        <div className="min-w-0">
          <SettingCell meta={meta} field={field} actions={actions} />
        </div>
        <div className="flex items-center justify-end">
          <IconButton label={expanded ? '詳しい設定を閉じる' : '詳しい設定を開く'} aria-expanded={expanded} onClick={() => actions.toggle(field.uid)}>
            <ChevronDown size={15} className={cx('transition-transform duration-150', expanded && 'rotate-180')} />
          </IconButton>
          {removable ? (
            <IconButton label={`「${field.label || '項目'}」を外す`} className="hover:bg-danger-wash hover:text-danger" onClick={() => actions.remove(field.uid)}>
              <Trash2 size={14} />
            </IconButton>
          ) : (
            <span className="size-7" title={field.isName ? 'レコードの表示名は外せません' : '業務ルールが使う項目は外せません'} />
          )}
        </div>
      </div>
      {error && <p className="pb-1.5 pl-[44px] sm:pl-[72px] text-sm text-danger">{error}</p>}
      {expanded && <FieldDetail field={field} fields={fields} actions={actions} />}
    </>
  )
}

// ---------------------------------------------------------------------------
// 画面本体
// ---------------------------------------------------------------------------

/** テーブルを足す・直す画面。サイドバーの「+」と、テーブルの画面の歯車から開く */
export function TableDesigner({ meta, target }: { meta: MetaResponse; target: { object?: string; draft?: TableDraft } }) {
  const close = useUI((s) => s.closeDesigner)
  const toast = useUI((s) => s.toast)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const object = findObject(meta, target.object)

  const [pristine] = useState(() => (object ? draftOf(object) : blankDraft(meta)))
  const [draft, setDraft] = useState<TableDraft>(() => target.draft ?? pristine)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const before = useMemo(() => toInput(pristine), [pristine])
  const dirty = useMemo(() => JSON.stringify(toInput(draft)) !== JSON.stringify(before), [draft, before])
  const errors = useMemo(() => validateDraft(draft, meta), [draft, meta])
  const creating = draft.mode === 'create'

  // <dialog> は開くときに先頭のボタン(アイコン)へフォーカスを当てる。新しいテーブルでは、名前から打ち始められるようにする
  const startAtLabel = creating && !target.draft
  useEffect(() => {
    if (startAtLabel) document.getElementById('table-label')?.focus()
  }, [startAtLabel])

  /**
   * その項目の名前欄へフォーカスを移す。必ず同期で行う: 次のフレームまで待つと、Enter に続けて速く打った文字が
   * 前の欄に入る。行を足す・動かすときは flushSync で先に描いてから呼ぶ
   */
  const focusName = (uid: string | undefined) => {
    const input = uid ? bodyRef.current?.querySelector<HTMLInputElement>(`[data-name-input="${uid}"]`) : null
    input?.focus()
    input?.scrollIntoView({ block: 'nearest' })
  }

  const setFields = (change: (fields: DraftField[]) => DraftField[]) => setDraft((d) => ({ ...d, fields: change(d.fields) }))
  const addField = () => {
    const field = newField(draft.fields)
    flushSync(() => setFields((fields) => [...fields, field]))
    focusName(field.uid)
  }

  const actions: RowActions = {
    patch: (uid, patch) => setFields((fields) => fields.map((f) => (f.uid === uid ? { ...f, ...patch } : f))),
    remove(uid) {
      const index = draft.fields.findIndex((f) => f.uid === uid)
      focusName(draft.fields[index - 1]?.uid)
      setFields((fields) => fields.filter((f) => f.uid !== uid))
    },
    next(uid) {
      const index = draft.fields.findIndex((f) => f.uid === uid)
      const following = draft.fields[index + 1]
      if (following) focusName(following.uid)
      else if (!isBlankRow(draft.fields[index])) addField()
    },
    shift(uid, delta) {
      flushSync(() =>
        setFields((fields) => {
          const from = fields.findIndex((f) => f.uid === uid)
          // 先頭は表示名の行で固定
          const to = Math.max(fields[0]?.isName ? 1 : 0, from + delta)
          return move(fields, from, to)
        }),
      )
      // 行を動かすと DOM が差し替わり、フォーカスが外れることがある
      focusName(uid)
    },
    toggle: (uid, open) =>
      setExpanded((prev) => {
        const next = new Set(prev)
        if (open ?? !next.has(uid)) next.add(uid)
        else next.delete(uid)
        return next
      }),
  }

  const dismiss = () => {
    // 確認は挟まない。書きかけは捨てず、トーストから続きへ戻れるようにする
    if (dirty) toast({ message: '変更を保存せずに閉じました', action: { label: '編集に戻る', run: () => useUI.getState().openDesigner(target.object, draft) } })
    close()
  }

  const applyMeta = (next: MetaResponse) => {
    qc.setQueryData(keys.meta, next)
    void qc.invalidateQueries({ queryKey: ['records'] })
    void qc.invalidateQueries({ queryKey: ['record'] })
    void qc.invalidateQueries({ queryKey: ['search'] })
  }

  const submit = async () => {
    if (saving) return
    if (errors.count > 0) {
      setShowErrors(true)
      const first = draft.fields.find((f) => errors.fields[f.uid])
      if (errors.label) bodyRef.current?.closest('form')?.querySelector<HTMLInputElement>('#table-label')?.focus()
      else if (first) {
        flushSync(() => actions.toggle(first.uid, true))
        focusName(first.uid)
      }
      return
    }
    setSaving(true)
    setServerError(null)
    try {
      const input = toInput(draft)
      if (creating) {
        applyMeta(await api.createObject(input))
        close()
        navigate(`/o/${input.key}`)
        toast({ message: `テーブル「${input.label}」を作成しました` })
      } else {
        applyMeta(await api.updateObject(draft.key, input))
        close()
        toast({
          message: 'テーブル設定を保存しました',
          action: dirty ? { label: '元に戻す', run: () => void api.updateObject(draft.key, before).then(applyMeta) } : undefined,
        })
      }
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : '保存できませんでした。もう一度試してください')
      setSaving(false)
    }
  }

  const removeTable = async () => {
    if (!object) return
    try {
      applyMeta(await api.deleteObject(object.key))
      close()
      if (location.pathname === `/o/${object.key}`) navigate(homePath(qc.getQueryData<MetaResponse>(keys.meta) ?? meta))
      toast({
        message: `テーブル「${object.label}」を削除しました`,
        action: { label: '元に戻す', run: () => void api.restoreObject(object.key).then(applyMeta) },
      })
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : '削除できませんでした。もう一度試してください')
    }
  }

  const nameRow = draft.fields[0]?.isName ? draft.fields[0] : null
  const sortableRows = nameRow ? draft.fields.slice(1) : draft.fields
  const counted = draft.fields.filter((f) => !isBlankRow(f)).length
  const title = creating ? 'テーブルを追加' : `${object?.label ?? 'テーブル'}の設定`

  return (
    <Modal label={title} onClose={dismiss} className="h-[min(760px,100%)] max-w-[920px]">
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !composing(e)) {
            e.preventDefault()
            void submit()
          }
        }}
      >
        <header className="flex flex-none items-start gap-3 px-5 pt-5 pb-4">
          <AppearancePicker draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
          <div className="min-w-0 flex-1">
            <input
              id="table-label"
              value={draft.label}
              aria-label="テーブル名"
              aria-invalid={showErrors && Boolean(errors.label)}
              placeholder="テーブル名"
              onChange={(e) => {
                const label = e.target.value
                setDraft((d) => ({ ...d, label, key: creating && !d.keyTouched ? autoTableKey(label, meta, d.key) : d.key }))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !composing(e)) {
                  e.preventDefault()
                  focusName(draft.fields[0]?.uid)
                }
              }}
              className="-ml-2 h-10 w-full rounded-md bg-transparent px-2 text-xl font-bold outline-none placeholder:text-ink-3 hover:bg-sunken focus:bg-paper focus:shadow-[inset_0_0_0_1.5px_var(--accent)]"
            />
            <div className="flex h-7 items-center gap-1 text-sm text-ink-3">
              <label htmlFor="table-key">列名</label>
              {creating ? (
                <input
                  id="table-key"
                  value={draft.key}
                  aria-invalid={showErrors && Boolean(errors.key)}
                  {...keyInputHandlers((key) => setDraft((d) => ({ ...d, key, keyTouched: true })))}
                  onBlur={(e) => setDraft((d) => ({ ...d, key: normalizeKey(e.currentTarget.value) }))}
                  className="h-6 w-44 rounded bg-transparent px-1 text-sm text-ink-2 outline-none hover:bg-sunken focus:bg-paper focus:shadow-[inset_0_0_0_1.5px_var(--accent)]"
                />
              ) : (
                <span className="px-1 text-ink-2">{draft.key}</span>
              )}
              {showErrors && (errors.label || errors.key) && <span className="text-danger">{errors.label ?? errors.key}</span>}
            </div>
          </div>
          <IconButton label="閉じる" onClick={dismiss}>
            <X size={16} />
          </IconButton>
        </header>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto border-t border-line">
          <div className="min-w-[700px]">
            <div
              className="sticky top-0 z-20 grid h-9 items-center gap-x-1 border-b border-line bg-raised pr-3 pl-1 sm:pl-8 text-sm text-ink-2"
              style={{ gridTemplateColumns: COLS }}
            >
              <span />
              <span className="px-2">
                項目名 <span className="text-ink-3 tabular-nums">{counted}</span>
              </span>
              <span className="px-2">データ型</span>
              <span className="text-center">必須</span>
              <span className="px-2">桁数・設定</span>
              <span />
            </div>

            {nameRow && (
              <FixedFieldRow meta={meta} field={nameRow} fields={draft.fields} expanded={expanded.has(nameRow.uid)} error={showErrors ? errors.fields[nameRow.uid] : undefined} actions={actions} />
            )}
            <DragDropProvider
              onDragEnd={(event) => {
                const { source } = event.operation
                if (event.canceled || !isSortable(source)) return
                const offset = nameRow ? 1 : 0
                const { initialIndex, index } = source.sortable
                setFields((fields) => move(fields, initialIndex + offset, index + offset))
              }}
            >
              {sortableRows.map((f, i) => (
                <SortableFieldRow key={f.uid} meta={meta} field={f} fields={draft.fields} index={i} expanded={expanded.has(f.uid)} error={showErrors ? errors.fields[f.uid] : undefined} actions={actions} />
              ))}
            </DragDropProvider>

            <button
              type="button"
              onClick={() => addField()}
              className="flex h-10 w-full items-center gap-[13px] pl-[10px] sm:pl-[38px] text-left text-ink-2 hover:bg-chrome hover:text-ink"
            >
              <Plus size={15} aria-hidden />
              項目を追加
              <span className="ml-1 hidden text-sm text-ink-3 sm:inline">項目名の欄で Enter を押しても足せます</span>
            </button>
          </div>
        </div>

        <footer className="flex flex-none flex-wrap items-center gap-2 border-t border-line bg-chrome px-5 py-3">
          {!creating && !draft.system && (
            <Button variant="danger" onClick={() => void removeTable()}>
              <Trash2 size={14} aria-hidden />
              テーブルを削除
            </Button>
          )}
          <p className={cx('min-w-0 flex-1 truncate text-sm', serverError ? 'text-danger' : 'text-ink-3')} role={serverError ? 'alert' : undefined}>
            {serverError ?? (showErrors && errors.count > 0 ? `${errors.count} か所を直してください` : '作成日時と更新日時は自動で付きます')}
          </p>
          <Button variant="ghost" onClick={dismiss}>
            キャンセル
          </Button>
          <Button variant="primary" type="submit" disabled={saving || (!creating && !dirty)}>
            {creating ? 'テーブルを作成' : '変更を保存'}
            <span className="hidden opacity-80 sm:inline-flex sm:gap-0.5">
              <Kbd>Ctrl</Kbd>
              <Kbd>Enter</Kbd>
            </span>
          </Button>
        </footer>
      </form>
    </Modal>
  )
}
