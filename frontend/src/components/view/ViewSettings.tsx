import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { Eye, EyeOff, GripVertical, Rows3, SquareKanban, Star, Trash2 } from 'lucide-react'
import type { FieldMeta, KanbanViewConfig, ListViewConfig, MetaResponse, ObjectMeta, ViewInput, ViewMeta } from '@/api/types'
import { Tag } from '@/components/ui/basics'
import { Popover } from '@/components/ui/overlay'
import { cx } from '@/lib/cx'
import { fieldType } from '@/lib/icons'
import { columnCandidates, defaultWidth, newViewInput, toInput } from '@/lib/viewModel'
import { Select } from './ConditionEditor'

const row = 'flex h-8 items-center gap-2 rounded-md px-2 hover:bg-sunken'
const heading = 'px-2 pt-3 pb-1 text-sm text-ink-3'

function PropertyRow({ field, index, visible, onToggle }: { field: FieldMeta; index: number; visible: boolean; onToggle: () => void }) {
  const { ref, handleRef, isDragSource } = useSortable({ id: field.key, index, disabled: !visible })
  const t = fieldType(field.type)
  return (
    <div ref={ref} className={cx(row, 'group/p', isDragSource && 'relative z-10 bg-raised shadow-card', !visible && 'text-ink-3')}>
      <button ref={handleRef} type="button" aria-label={`「${field.label}」を並べ替える`} disabled={!visible} className={cx('grid size-5 flex-none cursor-grab place-items-center text-ink-3', !visible && 'invisible')}>
        <GripVertical size={13} aria-hidden />
      </button>
      <t.icon size={14} className="flex-none text-ink-3" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{field.label}</span>
      <button type="button" role="switch" aria-checked={visible} aria-label={`「${field.label}」を${visible ? '隠す' : '出す'}`} onClick={onToggle} className="grid size-6 place-items-center rounded text-ink-2 hover:bg-paper hover:text-ink">
        {visible ? <Eye size={14} aria-hidden /> : <EyeOff size={14} aria-hidden />}
      </button>
    </div>
  )
}

/** 表示する項目(一覧の列、カンバンのカードの項目)。出す・隠す・並べ替え */
function Properties({ object, keys, onChange, fixed }: { object: ObjectMeta; keys: string[]; onChange: (keys: string[]) => void; fixed?: string }) {
  const candidates = columnCandidates(object).filter((f) => f.key !== fixed)
  const shown = keys.map((k) => candidates.find((f) => f.key === k)).filter((f): f is FieldMeta => Boolean(f))
  const hidden = candidates.filter((f) => !keys.includes(f.key))
  return (
    <DragDropProvider
      onDragEnd={(e) => {
        const { source } = e.operation
        if (e.canceled || !isSortable(source)) return
        const next = [...shown.map((f) => f.key)]
        next.splice(source.sortable.index, 0, ...next.splice(source.sortable.initialIndex, 1))
        onChange(next)
      }}
    >
      {shown.map((f, i) => (
        <PropertyRow key={f.key} field={f} index={i} visible onToggle={() => onChange(keys.filter((k) => k !== f.key))} />
      ))}
      {hidden.map((f) => (
        <PropertyRow key={f.key} field={f} index={shown.length} visible={false} onToggle={() => onChange([...keys, f.key])} />
      ))}
    </DragDropProvider>
  )
}

/**
 * ビューの設定(Notion の「⋯」)。レイアウト、表示する項目、カンバンの分け方、お気に入り、削除。
 * 変えるとその場で保存する
 */
export function ViewSettings({
  anchor,
  meta,
  object,
  view,
  onClose,
  onChange,
  onDelete,
}: {
  anchor: HTMLElement
  meta: MetaResponse
  object: ObjectMeta
  view: ViewMeta
  onClose: () => void
  onChange: (input: ViewInput) => void
  onDelete: () => void
}) {
  void meta
  const input = toInput(view)
  const setConfig = (patch: Partial<ListViewConfig & KanbanViewConfig>) => {
    if (input.type === 'report') return
    onChange({ ...input, config: { ...input.config, ...patch } } as ViewInput)
  }
  const switchLayout = (type: 'list' | 'kanban') => {
    if (input.type === type) return
    const next = newViewInput(object, type, input.name, view)
    if (next) onChange({ ...next, pin: input.pin })
  }
  const selectFields = object.fields.filter((f) => f.type === 'select')
  const currencyFields = object.fields.filter((f) => f.type === 'currency')
  const groupBy = input.type === 'kanban' ? object.fields.find((f) => f.key === input.config.group_by) : undefined

  return (
    <Popover anchor={anchor} onClose={onClose} align="end" width={320} className="max-h-[80vh]">
      <div className="overflow-y-auto p-1.5">
        <input
          value={input.name}
          aria-label="ビューの名前"
          onChange={(e) => onChange({ ...input, name: e.target.value })}
          className="h-9 w-full rounded-md bg-transparent px-2 text-base font-bold outline-none hover:bg-sunken focus:bg-paper focus:shadow-[inset_0_0_0_1.5px_var(--accent)]"
        />

        {input.type !== 'report' && (
          <>
            <p className={heading}>レイアウト</p>
            <div className="grid grid-cols-2 gap-1 px-1" role="radiogroup" aria-label="レイアウト">
              {(
                [
                  { type: 'list', label: '一覧', icon: Rows3 },
                  { type: 'kanban', label: 'カンバン', icon: SquareKanban, disabled: selectFields.length === 0 },
                ] as const
              ).map((l) => (
                <button
                  key={l.type}
                  type="button"
                  role="radio"
                  aria-checked={input.type === l.type}
                  disabled={'disabled' in l && l.disabled}
                  title={'disabled' in l && l.disabled ? '選択肢の項目が無いので、カンバンにできません' : undefined}
                  onClick={() => switchLayout(l.type)}
                  className={cx('flex h-9 items-center justify-center gap-1.5 rounded-md text-sm disabled:opacity-50', input.type === l.type ? 'bg-accent-wash font-bold text-accent-ink' : 'text-ink-2 hover:bg-sunken')}
                >
                  <l.icon size={15} aria-hidden />
                  {l.label}
                </button>
              ))}
            </div>
          </>
        )}

        {input.type === 'kanban' && groupBy && (
          <>
            <p className={heading}>分け方</p>
            <div className="px-2">
              <Select value={input.config.group_by} label="分ける項目" onChange={(key) => setConfig({ group_by: key, hidden_groups: [], card_fields: input.config.card_fields.filter((k) => k !== key) })}>
                {selectFields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
            <p className={heading}>出す列</p>
            <div className="flex flex-wrap gap-1 px-2 pb-1" role="group" aria-label="出す列">
              {(groupBy.options ?? []).map((o) => {
                const hidden = input.config.hidden_groups?.includes(o.value)
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="switch"
                    aria-checked={!hidden}
                    onClick={() => setConfig({ hidden_groups: hidden ? (input.config.hidden_groups ?? []).filter((v) => v !== o.value) : [...(input.config.hidden_groups ?? []), o.value] })}
                    className={cx('rounded-md', hidden && 'opacity-40')}
                    title={hidden ? '押すと出す' : '押すと隠す'}
                  >
                    <Tag color={o.color}>{o.label}</Tag>
                  </button>
                )
              })}
            </div>
            {currencyFields.length > 0 && (
              <>
                <p className={heading}>列の見出しに合計</p>
                <div className="px-2">
                  <Select value={input.config.sum_field ?? ''} label="合計する項目" onChange={(key) => setConfig({ sum_field: key || undefined })}>
                    <option value="">出さない</option>
                    {currencyFields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </>
            )}
          </>
        )}

        {input.type === 'list' && (
          <>
            <p className={heading}>表示する項目</p>
            <Properties
              object={object}
              keys={input.config.columns.map((c) => c.field)}
              onChange={(keys) =>
                setConfig({
                  columns: keys.map((k) => input.config.columns.find((c) => c.field === k) ?? { field: k, width: defaultWidth(object, object.fields.find((f) => f.key === k)!) }),
                })
              }
            />
          </>
        )}
        {input.type === 'kanban' && (
          <>
            <p className={heading}>カードに出す項目</p>
            <Properties object={object} keys={input.config.card_fields} onChange={(keys) => setConfig({ card_fields: keys })} fixed={object.name_field} />
          </>
        )}

        <p className={heading}>サイドバー</p>
        <label className={cx(row, 'cursor-pointer')}>
          <Star size={14} className={cx('flex-none', input.pin ? 'fill-current text-warn' : 'text-ink-3')} aria-hidden />
          <span className="flex-1">お気に入りに出す</span>
          <input
            type="checkbox"
            checked={Boolean(input.pin)}
            onChange={(e) => onChange({ ...input, pin: e.target.checked ? { label: input.name, position: 999, show_count: input.type === 'list' } : undefined })}
            className="accent-[var(--accent)]"
          />
        </label>
        {input.pin && (
          <div className="grid gap-1 px-2 pb-1">
            <input
              value={input.pin.label}
              aria-label="サイドバーでの名前"
              placeholder="サイドバーでの名前"
              onChange={(e) => onChange({ ...input, pin: { ...input.pin!, label: e.target.value } })}
              className="h-8 w-full rounded-md bg-paper px-2 text-base outline-none shadow-[inset_0_0_0_1px_var(--line-strong)] focus:shadow-[inset_0_0_0_1.5px_var(--accent)]"
            />
            <label className="flex h-7 items-center gap-2 px-1 text-sm text-ink-2">
              <input type="checkbox" checked={Boolean(input.pin.show_count)} onChange={(e) => onChange({ ...input, pin: { ...input.pin!, show_count: e.target.checked } })} className="accent-[var(--accent)]" />
              件数を出す
            </label>
          </div>
        )}

        <div className="mt-2 border-t border-line pt-1.5">
          <button type="button" onClick={onDelete} className={cx(row, 'w-full text-danger hover:bg-danger-wash')}>
            <Trash2 size={14} aria-hidden />
            ビューを削除
          </button>
        </div>
      </div>
    </Popover>
  )
}
