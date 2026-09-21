import type { CSSProperties, MouseEvent } from 'react'
import type { ObjectMeta, Row } from '@/api/types'
import { fieldOf, optionOf } from '@/lib/records'

/** 優先度の色。Todoist と同じ並び(P1 赤・P2 橙・P3 青・P4 灰)で、チェックの輪の色になる */
function priorityColor(meta: ObjectMeta, row: Row): string {
  const field = fieldOf(meta, 'priority')
  const color = field ? optionOf(field, row.priority)?.color : undefined
  return !color || color === 'gray' ? 'var(--ink-3)' : `var(--tag-${color}-ink)`
}

/** 完了のチェック。見た目と動きは styles/index.css の .task-check */
export function TaskCheck({
  meta,
  row,
  checked,
  onToggle,
}: {
  meta: ObjectMeta
  row: Row
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? '未完了に戻す' : '完了にする'}
      title={checked ? '未完了に戻す' : '完了にする (E)'}
      data-checked={checked}
      className="task-check"
      style={{ '--c': priorityColor(meta, row) } as CSSProperties}
      onClick={(e: MouseEvent) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </button>
  )
}
