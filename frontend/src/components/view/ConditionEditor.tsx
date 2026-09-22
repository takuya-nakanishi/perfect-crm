import { useQuery } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { Condition, FieldMeta, FilterOp, MetaResponse, Scalar } from '@/api/types'
import { ObjectIcon, Tag } from '@/components/ui/basics'
import { ChoiceList } from '@/components/ui/ChoiceList'
import { Popover } from '@/components/ui/overlay'
import { cx } from '@/lib/cx'
import { useDebounced } from '@/lib/useDebounced'
import { DATE_MACROS, multiValue, needsValue, opLabel, opsFor } from '@/lib/viewModel'

const input = 'h-8 w-full min-w-0 rounded-md bg-paper px-2 text-base text-ink outline-none shadow-[inset_0_0_0_1px_var(--line-strong)] placeholder:text-ink-3 focus:shadow-[inset_0_0_0_1.5px_var(--accent)]'

/** ネイティブの <select>。矢印は自前で描く(OS の既定と色を揃えるため) */
export function Select({ value, onChange, children, label }: { value: string; onChange: (v: string) => void; children: ReactNode; label: string }) {
  return (
    <div className="relative min-w-0">
      <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} className={cx(input, 'appearance-none pr-7')}>
        {children}
      </select>
      <svg className="pointer-events-none absolute top-2.5 right-2 size-3 text-ink-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M2.5 4.5 6 8l3.5-3.5" />
      </svg>
    </div>
  )
}

const toList = (value: Condition['value']): Scalar[] => (Array.isArray(value) ? value : value === null || value === undefined ? [] : [value])

/** 値の欄。型ごとに、選択肢・利用者・参照・日付・数値・文字を出し分ける */
function ValueEditor({ meta, field, condition, onChange }: { meta: MetaResponse; field: FieldMeta; condition: Condition; onChange: (c: Condition) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [query, setQuery] = useState('')
  const q = useDebounced(query, 120)
  const multi = multiValue(condition.op)
  const values = toList(condition.value)
  const set = (value: Scalar | Scalar[], extra?: Partial<Condition>) => onChange({ ...condition, value, ...extra })
  const toggle = (v: Scalar) => {
    if (multi) set(values.includes(v) ? values.filter((x) => x !== v) : [...values, v])
    else {
      set(v)
      setAnchor(null)
    }
  }
  const target = field.type === 'relation' ? field.target : undefined
  const candidates = useQuery({
    queryKey: ['records', target ?? '', { q, limit: 8 }],
    queryFn: () => api.listRecords(target!, { q, limit: 8, sort: [{ field: 'updated_at', dir: 'desc' }] }),
    enabled: Boolean(target) && anchor !== null,
  })
  const targetMeta = target ? meta.objects.find((o) => o.key === target) : undefined

  if (field.type === 'checkbox') {
    return (
      <Select value={condition.value ? 'true' : 'false'} onChange={(v) => set(v === 'true')} label="値">
        <option value="true">はい</option>
        <option value="false">いいえ</option>
      </Select>
    )
  }
  if (field.type === 'select' || field.type === 'multi_select') {
    const chosen = (field.options ?? []).filter((o) => values.includes(o.value))
    return (
      <>
        <button type="button" onClick={(e) => setAnchor(e.currentTarget)} aria-label="値" className={cx(input, 'flex items-center gap-1 overflow-hidden text-left')}>
          {chosen.length === 0 && <span className="text-ink-3">選択肢を選ぶ</span>}
          {chosen.slice(0, 3).map((o) => (
            <Tag key={o.value} color={o.color}>
              {o.label}
            </Tag>
          ))}
          {chosen.length > 3 && <span className="text-sm text-ink-3">+{chosen.length - 3}</span>}
        </button>
        {anchor && (
          <Popover anchor={anchor} onClose={() => setAnchor(null)} width={Math.max(220, anchor.offsetWidth)}>
            <ChoiceList
              choices={(field.options ?? []).map((o) => ({
                id: o.value,
                node: <Tag color={o.color}>{o.label}</Tag>,
                searchText: o.label,
                selected: values.includes(o.value),
                commit: () => toggle(o.value),
              }))}
            />
            {multi && <p className="border-t border-line px-3 py-2 text-xs text-ink-3">押すたびに付け外し。Esc で閉じる</p>}
          </Popover>
        )}
      </>
    )
  }
  if (field.type === 'user') {
    return (
      <Select value={String(values[0] ?? '')} onChange={(v) => set(v || null)} label="値">
        <option value="">利用者を選ぶ</option>
        <option value="$me">自分</option>
        {meta.users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Select>
    )
  }
  if (field.type === 'relation' && targetMeta) {
    const current = values[0]
    const name = typeof current === 'string' ? (condition.value_label ?? '…') : null
    return (
      <>
        <button type="button" onClick={(e) => setAnchor(e.currentTarget)} aria-label="値" className={cx(input, 'flex items-center gap-1.5 text-left')}>
          {name ? (
            <>
              <ObjectIcon icon={targetMeta.icon} color={targetMeta.color} size={12} />
              <span className="truncate">{name}</span>
            </>
          ) : (
            <span className="text-ink-3">{targetMeta.label}を選ぶ</span>
          )}
        </button>
        {anchor && (
          <Popover anchor={anchor} onClose={() => setAnchor(null)} width={300}>
            <ChoiceList
              query={query}
              onQuery={setQuery}
              placeholder={`${targetMeta.label}を探す`}
              loading={candidates.isLoading}
              choices={(candidates.data?.records ?? []).map((r) => {
                const label = String(r[targetMeta.name_field] ?? '')
                return {
                  id: r.id,
                  node: <span className="truncate">{label}</span>,
                  searchText: label,
                  selected: r.id === current,
                  commit: () => {
                    // 表示名は条件に添えて持つ(チップに出すため。サーバは評価に使わない)
                    set(r.id, { value_label: label })
                    setAnchor(null)
                  },
                }
              })}
            />
          </Popover>
        )}
      </>
    )
  }
  if (field.type === 'date' || field.type === 'datetime') {
    const raw = typeof values[0] === 'string' ? values[0] : '$today'
    const isMacro = raw.startsWith('$')
    return (
      <div className="flex gap-1">
        <Select value={isMacro ? raw : 'custom'} onChange={(v) => set(v === 'custom' ? new Date().toISOString().slice(0, 10) : v)} label="日付の基準">
          {DATE_MACROS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
          <option value="custom">日付を指定</option>
        </Select>
        {!isMacro && <input type="date" value={raw} aria-label="日付" onChange={(e) => set(e.target.value || null)} className={cx(input, 'w-40')} />}
      </div>
    )
  }
  const numeric = ['number', 'currency', 'percent'].includes(field.type)
  return (
    <input
      value={values[0] === null || values[0] === undefined ? '' : String(values[0])}
      inputMode={numeric ? 'decimal' : undefined}
      aria-label="値"
      autoFocus={!numeric}
      placeholder={numeric ? '数値' : '文字'}
      onChange={(e) => {
        const t = e.target.value
        if (!numeric) return set(t)
        const n = Number(t.normalize('NFKC').replace(/[¥,\s%円]/g, ''))
        set(t === '' ? null : Number.isFinite(n) ? n : 0)
      }}
      className={input}
    />
  )
}

/** 条件 1 つの編集(項目・条件・値)。フィルターのチップを押すと開く。変えるとすぐ効く */
export function ConditionEditor({
  meta,
  fields,
  condition,
  onChange,
  onRemove,
}: {
  meta: MetaResponse
  fields: FieldMeta[]
  condition: Condition
  onChange: (c: Condition) => void
  onRemove: () => void
}) {
  const field = fields.find((f) => f.key === condition.field) ?? fields[0]
  return (
    <div className="w-[340px] p-3">
      <div className="grid gap-2">
        <Select
          value={field.key}
          label="項目"
          onChange={(key) => {
            const next = fields.find((f) => f.key === key)!
            const op = opsFor(next.type)[0]
            onChange({ field: next.key, op, value: next.type === 'checkbox' ? true : next.type === 'date' || next.type === 'datetime' ? '$today' : multiValue(op) ? [] : null })
          }}
        >
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </Select>
        <Select
          value={condition.op}
          label="条件"
          onChange={(raw) => {
            const op = raw as FilterOp
            const was = toList(condition.value)
            onChange({ field: condition.field, op, value: !needsValue(op) ? undefined : multiValue(op) ? was : (was[0] ?? null), value_label: condition.value_label })
          }}
        >
          {opsFor(field.type).map((op) => (
            <option key={op} value={op}>
              {opLabel(field, op)}
            </option>
          ))}
        </Select>
        {needsValue(condition.op) && <ValueEditor meta={meta} field={field} condition={condition} onChange={onChange} />}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={onRemove} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm text-ink-2 hover:bg-danger-wash hover:text-danger">
          <X size={13} aria-hidden />
          条件を外す
        </button>
        <span className="inline-flex items-center gap-1 text-xs text-ink-3">
          <Check size={12} aria-hidden />
          変えるとすぐ効きます
        </span>
      </div>
    </div>
  )
}
