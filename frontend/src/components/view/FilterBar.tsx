import { ArrowDown, ArrowUp, Funnel, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Condition, FieldMeta, Filter, MetaResponse, ObjectMeta, Sort, ViewMeta } from '@/api/types'
import { ChoiceList } from '@/components/ui/ChoiceList'
import { Popover } from '@/components/ui/overlay'
import { cx } from '@/lib/cx'
import { fieldType } from '@/lib/icons'
import { describe, filterableFields, flatten, isComplete, newCondition, unflatten, type FlatFilter } from '@/lib/viewModel'
import { ConditionEditor } from './ConditionEditor'

const chip = 'inline-flex h-7 max-w-full items-center gap-1 rounded-md px-2 text-sm shadow-[inset_0_0_0_1px_var(--line)] hover:bg-sunken'

/** 項目を 1 つ選ぶ一覧(条件と並び替えの追加に使う) */
export function FieldPicker({ anchor, fields, onClose, onPick }: { anchor: HTMLElement; fields: FieldMeta[]; onClose: () => void; onPick: (f: FieldMeta) => void }) {
  const [query, setQuery] = useState('')
  const visible = fields.filter((f) => f.label.toLowerCase().includes(query.toLowerCase()))
  return (
    <Popover anchor={anchor} onClose={onClose} width={260}>
      <ChoiceList
        query={query}
        onQuery={setQuery}
        placeholder="項目を探す"
        choices={visible.map((f) => {
          const t = fieldType(f.type)
          return {
            id: f.key,
            node: (
              <>
                <t.icon size={14} className="flex-none text-ink-3" aria-hidden />
                <span className="truncate">{f.label}</span>
              </>
            ),
            searchText: f.label,
            selected: false,
            commit: () => onPick(f),
          }
        })}
      />
    </Popover>
  )
}

/**
 * ビューの条件。タブ行の下にチップで並び、押すと編集、「+」で足す。変えるとその場でビューに保存する(Notion と同じ)。
 * 値がまだ無い条件はチップに出すが、サーバへは送らない(isComplete)
 */
export function FilterBar({
  meta,
  object,
  view,
  open,
  onChange,
}: {
  meta: MetaResponse
  object: ObjectMeta
  view: ViewMeta & { type: 'list' | 'kanban' }
  /** 条件が無くても帯を出す(ヘッダの「フィルター」を押したとき)。押した直後は項目の一覧を開く */
  open: { pick: boolean } | null
  onChange: (filter: Filter | undefined) => void
}) {
  const fields = filterableFields(object)
  const flat = flatten(view.config.filter)
  const [editing, setEditing] = useState<{ index: number; anchor: HTMLElement } | null>(null)
  const [adding, setAdding] = useState<HTMLElement | null>(null)
  const [draft, setDraft] = useState<Condition[] | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  // ヘッダの「フィルター」から来たときは、すぐ項目を選ばせる
  useEffect(() => {
    if (open?.pick && addRef.current) setAdding(addRef.current)
  }, [open])
  // 編集中は下書きを描く(値の無い条件も保てる)。閉じたら値のあるものだけ保存する
  const conditions = draft ?? flat.conditions

  const commit = (next: FlatFilter) => onChange(unflatten({ ...next, conditions: next.conditions.filter(isComplete) }))
  const update = (index: number, c: Condition) => {
    const next = conditions.map((x, i) => (i === index ? c : x))
    setDraft(next)
    commit({ ...flat, conditions: next })
  }
  const remove = (index: number) => {
    const next = conditions.filter((_, i) => i !== index)
    setDraft(null)
    setEditing(null)
    commit({ ...flat, conditions: next })
  }
  const closeEditor = () => {
    setEditing(null)
    setDraft(null)
  }
  const toggleJoin = () => commit({ ...flat, conditions, join: flat.join === 'and' ? 'or' : 'and' })

  if (conditions.length === 0 && flat.advanced.length === 0 && !open) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5 md:px-5">
      <Funnel size={14} className="flex-none text-ink-3" aria-hidden />
      {conditions.map((c, i) => {
        const field = fields.find((f) => f.key === c.field)
        if (!field) return null
        const d = describe(meta, field, c)
        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            {i > 0 && (
              <button type="button" onClick={toggleJoin} className="rounded px-1 text-xs text-ink-3 hover:bg-sunken hover:text-ink" title="押すと切り替わる">
                {flat.join === 'and' ? 'かつ' : 'または'}
              </button>
            )}
            <span data-filter-chip className={cx(chip, 'pr-1', !isComplete(c) && 'text-ink-3', editing?.index === i && 'bg-sunken')}>
              <button type="button" onClick={(e) => setEditing({ index: i, anchor: e.currentTarget.parentElement! })} className="flex min-w-0 items-center gap-1">
                <span className="text-ink-2">{field.label}</span>
                <span className="text-ink-3">{d.op}</span>
                {d.value && <span className="truncate font-bold text-ink">{d.value}</span>}
              </button>
              <button type="button" aria-label={`条件「${field.label}」を外す`} onClick={() => remove(i)} className="grid size-5 place-items-center rounded text-ink-3 hover:bg-paper hover:text-ink">
                <X size={12} aria-hidden />
              </button>
            </span>
          </span>
        )
      })}
      {flat.advanced.map((_, i) => (
        <span key={`adv-${i}`} className={cx(chip, 'pr-1 text-ink-2')} title="入れ子の条件。ここでは編集できません">
          高度な条件
          <button type="button" aria-label="高度な条件を外す" onClick={() => commit({ ...flat, conditions, advanced: flat.advanced.filter((_, j) => j !== i) })} className="grid size-5 place-items-center rounded text-ink-3 hover:bg-paper hover:text-ink">
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <button ref={addRef} type="button" onClick={(e) => setAdding(e.currentTarget)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm text-ink-3 hover:bg-sunken hover:text-ink">
        <Plus size={13} aria-hidden />
        条件
      </button>
      {editing && (
        <Popover anchor={editing.anchor} onClose={closeEditor}>
          <ConditionEditor meta={meta} fields={fields} condition={conditions[editing.index]} onChange={(c) => update(editing.index, c)} onRemove={() => remove(editing.index)} />
        </Popover>
      )}
      {adding && (
        <FieldPicker
          anchor={adding}
          fields={fields}
          onClose={() => setAdding(null)}
          onPick={(f) => {
            const next = [...conditions, newCondition(f)]
            setDraft(next)
            setAdding(null)
            // 足したらすぐ編集(値を選ばせる)
            requestAnimationFrame(() => {
              const chips = document.querySelectorAll<HTMLElement>('[data-filter-chip]')
              const el = chips[chips.length - 1]
              if (el) setEditing({ index: next.length - 1, anchor: el })
            })
          }}
        />
      )}
    </div>
  )
}

/** 並び替え。ボタンを押すと一覧が出る: 項目を足す、昇順/降順、外す */
export function SortMenu({ anchor, object, sort, onClose, onChange }: { anchor: HTMLElement; object: ObjectMeta; sort: Sort[]; onClose: () => void; onChange: (s: Sort[]) => void }) {
  const [adding, setAdding] = useState<HTMLElement | null>(null)
  const fields = object.fields.filter((f) => f.type !== 'polymorphic' && f.type !== 'drive_files' && f.type !== 'richtext' && f.type !== 'textarea')
  const rest = fields.filter((f) => !sort.some((s) => s.field === f.key))
  return (
    <Popover anchor={anchor} onClose={onClose} align="end" width={300}>
      <div className="p-2">
        {sort.length === 0 && <p className="px-2 py-1.5 text-sm text-ink-3">並び替えはありません(ビューの既定の順)</p>}
        {sort.map((s, i) => {
          const field = fields.find((f) => f.key === s.field)
          return (
            <div key={s.field} className="flex h-8 items-center gap-1 rounded-md px-1 hover:bg-sunken">
              <span className="w-5 flex-none text-center text-xs text-ink-3 tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{field?.label ?? s.field}</span>
              <button
                type="button"
                onClick={() => onChange(sort.map((x, j) => (j === i ? { ...x, dir: x.dir === 'asc' ? 'desc' : 'asc' } : x)))}
                className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-sm text-ink-2 hover:bg-paper hover:text-ink"
                title="押すと昇順と降順が切り替わる"
              >
                {s.dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />}
                {s.dir === 'asc' ? '昇順' : '降順'}
              </button>
              <button type="button" aria-label={`並び替え「${field?.label ?? s.field}」を外す`} onClick={() => onChange(sort.filter((_, j) => j !== i))} className="grid size-6 place-items-center rounded text-ink-3 hover:bg-paper hover:text-ink">
                <X size={12} aria-hidden />
              </button>
            </div>
          )
        })}
        <button type="button" onClick={(e) => setAdding(e.currentTarget)} className="mt-1 flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-sm text-ink-2 hover:bg-sunken hover:text-ink">
          <Plus size={13} aria-hidden />
          並び替えを追加
        </button>
      </div>
      {adding && <FieldPicker anchor={adding} fields={rest} onClose={() => setAdding(null)} onPick={(f) => (onChange([...sort, { field: f.key, dir: 'asc' }]), setAdding(null))} />}
    </Popover>
  )
}
