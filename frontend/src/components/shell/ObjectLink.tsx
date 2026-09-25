import { Link } from 'react-router'
import type { ObjectMeta } from '@/api/types'
import { ObjectIcon } from '@/components/ui/basics'
import { cx } from '@/lib/cx'

export const rowCls = 'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-base transition-colors duration-100'

/** サイドバーのテーブル 1 行。並べ替えは SortableObjectList が、この行に ref を付けて行う */
export function ObjectLink({
  object,
  index,
  active,
  onNavigate,
  dragRef,
  dragging,
}: {
  object: ObjectMeta
  index: number
  active: boolean
  onNavigate: () => void
  dragRef?: (el: HTMLAnchorElement | null) => void
  dragging?: boolean
}) {
  return (
    <Link
      ref={dragRef}
      to={`/o/${object.key}`}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={index < 9 ? `${index + 1}。ドラッグで並べ替え` : 'ドラッグで並べ替え'}
      className={cx(
        rowCls,
        active ? 'bg-accent-wash font-bold text-accent-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink',
        dragging && 'relative z-10 bg-raised shadow-card',
      )}
    >
      <ObjectIcon icon={object.icon} color={object.color} size={14} />
      <span className="min-w-0 flex-1 truncate">{object.label}</span>
    </Link>
  )
}
