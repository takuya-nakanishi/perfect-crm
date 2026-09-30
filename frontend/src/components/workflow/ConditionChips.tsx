import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import type { Condition, Filter, MetaResponse, ObjectMeta } from '@/api/types'
import { Popover } from '@/components/ui/overlay'
import { ConditionEditor } from '@/components/view/ConditionEditor'
import { FieldPicker } from '@/components/view/FilterBar'
import { cx } from '@/lib/cx'
import { describe, filterableFields, flatten, isComplete, newCondition, unflatten } from '@/lib/viewModel'

const chip = 'inline-flex h-7 max-w-full items-center gap-1 rounded-md px-2 text-sm shadow-[inset_0_0_0_1px_var(--line)] hover:bg-sunken'

/**
 * ワークフローの条件。ビューのフィルターと同じチップと編集の部品(意味もビューと同じ)。
 * 違いは 2 つ: 「自分」は使えない(誰の書き込みでも動くので、自分が決まらない)、値の無い条件は保存しない
 * (値を入れ終わるまでは下書きとして持つ)
 */
export function ConditionChips({
  meta,
  object,
  filter,
  onChange,
  invalid,
}: {
  meta: MetaResponse
  object: ObjectMeta
  filter: Filter | undefined
  onChange: (filter: Filter | undefined) => void
  invalid?: boolean
}) {
  const fields = filterableFields(object)
  const flat = flatten(filter)
  const [draft, setDraft] = useState<Condition[] | null>(null)
  const [editing, setEditing] = useState<{ index: number; anchor: HTMLElement } | null>(null)
  const [adding, setAdding] = useState<HTMLElement | null>(null)
  const conditions = draft ?? flat.conditions

  const commit = (next: Condition[], join = flat.join) => onChange(unflatten({ ...flat, join, conditions: next.filter(isComplete) }))
  const update = (index: number, c: Condition) => {
    const next = conditions.map((x, i) => (i === index ? c : x))
    setDraft(next)
    commit(next)
  }
  const remove = (index: number) => {
    const next = conditions.filter((_, i) => i !== index)
    setDraft(null)
    setEditing(null)
    commit(next)
  }

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1.5">
      {conditions.map((c, i) => {
        const field = fields.find((f) => f.key === c.field)
        const d = field ? describe(meta, field, c) : null
        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            {i > 0 && (
              <button type="button" onClick={() => commit(conditions, flat.join === 'and' ? 'or' : 'and')} className="rounded px-1 text-xs text-ink-3 hover:bg-sunken hover:text-ink" title="押すと切り替わる">
                {flat.join === 'and' ? 'かつ' : 'または'}
              </button>
            )}
            <span data-condition-chip className={cx(chip, 'pr-1', (!field || !isComplete(c)) && 'text-ink-3', !field && 'shadow-[inset_0_0_0_1px_var(--danger)]', editing?.index === i && 'bg-sunken')}>
              <button
                type="button"
                disabled={!field}
                onClick={(e) => setEditing({ index: i, anchor: e.currentTarget.parentElement! })}
                className="flex min-w-0 items-center gap-1"
                title={field ? undefined : 'この項目はテーブルから外されています。条件を外してください'}
              >
                <span className="text-ink-2">{field?.label ?? c.field}</span>
                {d && <span className="text-ink-3">{d.op}</span>}
                {d?.value && <span className="truncate font-bold text-ink">{d.value}</span>}
              </button>
              <button type="button" aria-label={`条件「${field?.label ?? c.field}」を外す`} onClick={() => remove(i)} className="grid size-5 place-items-center rounded text-ink-3 hover:bg-paper hover:text-ink">
                <X size={12} aria-hidden />
              </button>
            </span>
          </span>
        )
      })}
      {flat.advanced.length > 0 && <span className={cx(chip, 'text-ink-2')} title="入れ子の条件。ここでは編集できません">高度な条件</span>}
      <button
        type="button"
        onClick={(e) => setAdding(e.currentTarget)}
        className={cx('inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm hover:bg-sunken hover:text-ink', invalid ? 'text-danger shadow-[inset_0_0_0_1px_var(--danger)]' : 'text-ink-3')}
      >
        <Plus size={13} aria-hidden />
        条件
      </button>
      {editing && conditions[editing.index] && (
        <Popover
          anchor={editing.anchor}
          onClose={() => {
            setEditing(null)
            setDraft(null)
          }}
        >
          <ConditionEditor meta={meta} fields={fields} condition={conditions[editing.index]} onChange={(c) => update(editing.index, c)} onRemove={() => remove(editing.index)} allowMe={false} live={false} />
        </Popover>
      )}
      {adding && (
        <FieldPicker
          anchor={adding}
          fields={fields}
          onClose={() => setAdding(null)}
          onPick={(f) => {
            const next = [...conditions, newCondition(f)]
            // 足した条件のチップを先に描いてから、その場で値を選ばせる
            flushSync(() => {
              setDraft(next)
              setAdding(null)
            })
            const chips = document.querySelectorAll<HTMLElement>('[data-condition-chip]')
            const el = chips[chips.length - 1]
            if (el) setEditing({ index: next.length - 1, anchor: el })
          }}
        />
      )}
    </div>
  )
}
