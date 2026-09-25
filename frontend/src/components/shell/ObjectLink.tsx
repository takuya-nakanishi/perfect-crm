import { Link } from 'react-router'
import type { ObjectMeta } from '@/api/types'
import { ObjectIcon } from '@/components/ui/basics'
import { cx } from '@/lib/cx'

export const rowCls = 'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-base transition-colors duration-100'

/** サイドバーのテーブル 1 行。つまんで動かすのは SidebarDnd が、この行に ref を付けて行う */
export function ObjectLink({
  object,
  index,
  active,
  inFolder,
  editable,
  onNavigate,
  dragRef,
  dragging,
}: {
  object: ObjectMeta
  /** サイドバーの上からの順(0 始まり)。1…9 のキーの案内に使う */
  index: number
  active: boolean
  /** フォルダの中の行。アイコンをフォルダの名前の位置まで下げる */
  inFolder?: boolean
  /** つまんで並べ替え・フォルダへ移せる(管理者) */
  editable?: boolean
  onNavigate: () => void
  dragRef?: (el: HTMLAnchorElement | null) => void
  /** つまんで動かしている最中の元の行(薄くする) */
  dragging?: boolean
}) {
  const hint = editable ? 'ドラッグで並べ替え・フォルダへ移動' : undefined
  return (
    <Link
      ref={dragRef}
      to={`/o/${object.key}`}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={[index < 9 ? `${index + 1}` : undefined, hint].filter(Boolean).join('。') || undefined}
      className={cx(
        rowCls,
        inFolder && 'pl-9',
        active ? 'bg-accent-wash font-bold text-accent-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink',
        dragging && 'opacity-35',
      )}
    >
      <ObjectIcon icon={object.icon} color={object.color} size={14} />
      <span className="min-w-0 flex-1 truncate">{object.label}</span>
    </Link>
  )
}
