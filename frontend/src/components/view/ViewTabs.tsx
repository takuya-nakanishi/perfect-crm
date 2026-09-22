import { ChevronDown, Copy, Pencil, Plus, Rows3, Settings2, SquareKanban, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ObjectMeta, ViewMeta } from '@/api/types'
import { Popover } from '@/components/ui/overlay'
import { cx } from '@/lib/cx'
import { VIEW_ICONS } from '@/lib/icons'

const item = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ink hover:bg-sunken'

/**
 * ビューのタブ(Notion の型)。押すと切り替え、開いているタブをもう一度押すとメニュー、末尾の「+」で追加。
 * 名前の変更は、タブの文字がその場で入力欄になる
 */
export function ViewTabs({
  object,
  views,
  activeId,
  onSelect,
  onAdd,
  onRename,
  onDuplicate,
  onTogglePin,
  onDelete,
  onOpenSettings,
}: {
  object: ObjectMeta
  views: ViewMeta[]
  activeId: string | undefined
  onSelect: (id: string) => void
  onAdd: (type: 'list' | 'kanban') => void
  onRename: (view: ViewMeta, name: string) => void
  onDuplicate: (view: ViewMeta) => void
  onTogglePin: (view: ViewMeta) => void
  onDelete: (view: ViewMeta) => void
  onOpenSettings: (view: ViewMeta, anchor: HTMLElement) => void
}) {
  const [menu, setMenu] = useState<{ view: ViewMeta; anchor: HTMLElement } | null>(null)
  const [adding, setAdding] = useState<HTMLElement | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const canKanban = object.fields.some((f) => f.type === 'select')

  const finishRename = () => {
    if (!renaming) return
    const view = views.find((v) => v.id === renaming.id)
    const name = renaming.name.trim()
    if (view && name && name !== view.name) onRename(view, name)
    setRenaming(null)
  }

  return (
    <div role="tablist" aria-label="ビュー" className="scrollbar-none flex items-center gap-0.5 overflow-x-auto px-3 md:px-4">
      {views.map((v, i) => {
        const Icon = VIEW_ICONS[v.type]
        const active = v.id === activeId
        if (renaming?.id === v.id) {
          return (
            <span key={v.id} className="relative flex h-9 flex-none items-center gap-1.5 px-2.5">
              <Icon size={15} className="text-accent" aria-hidden />
              <input
                autoFocus
                value={renaming.name}
                aria-label="ビューの名前"
                onChange={(e) => setRenaming({ id: v.id, name: e.target.value })}
                onBlur={finishRename}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setRenaming(null)
                  }
                }}
                className="h-7 w-32 rounded bg-paper px-1.5 text-base font-bold outline-none shadow-[inset_0_0_0_1.5px_var(--accent)]"
              />
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" aria-hidden />
            </span>
          )
        }
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={active ? 'もう一度押すとメニュー' : i < 9 ? `${v.name} (${i + 1})` : v.name}
            onClick={(e) => (active ? setMenu({ view: v, anchor: e.currentTarget }) : onSelect(v.id))}
            onDoubleClick={() => setRenaming({ id: v.id, name: v.name })}
            className={cx(
              'relative flex h-9 flex-none items-center gap-1.5 rounded-t-md px-2.5 text-base whitespace-nowrap transition-colors duration-100',
              active ? 'font-bold text-ink' : 'text-ink-2 hover:text-ink',
            )}
          >
            <Icon size={15} className={active ? 'text-accent' : undefined} aria-hidden />
            {v.name}
            {v.pin && <Star size={11} className="fill-current text-warn" aria-label="お気に入り" />}
            {active && <ChevronDown size={12} className="text-ink-3" aria-hidden />}
            {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" aria-hidden />}
          </button>
        )
      })}
      <button
        type="button"
        aria-label="ビューを追加"
        title="ビューを追加"
        onClick={(e) => setAdding(e.currentTarget)}
        className="grid size-7 flex-none place-items-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink"
      >
        <Plus size={15} aria-hidden />
      </button>

      {menu && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={220}>
          <div role="menu" className="p-1.5">
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setMenu(null)
                setRenaming({ id: menu.view.id, name: menu.view.name })
              }}
            >
              <Pencil size={14} className="text-ink-2" aria-hidden />
              名前を変更
            </button>
            {menu.view.type !== 'report' && (
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={(e) => {
                  const anchor = menu.anchor
                  setMenu(null)
                  onOpenSettings(menu.view, anchor)
                  e.stopPropagation()
                }}
              >
                <Settings2 size={14} className="text-ink-2" aria-hidden />
                表示項目・分け方・お気に入り
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setMenu(null)
                onDuplicate(menu.view)
              }}
            >
              <Copy size={14} className="text-ink-2" aria-hidden />
              複製
            </button>
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setMenu(null)
                onTogglePin(menu.view)
              }}
            >
              <Star size={14} className={cx(menu.view.pin ? 'fill-current text-warn' : 'text-ink-2')} aria-hidden />
              {menu.view.pin ? 'お気に入りから外す' : 'お気に入りに出す'}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={views.length <= 1}
              className={cx(item, 'text-danger hover:bg-danger-wash disabled:opacity-50')}
              onClick={() => {
                setMenu(null)
                onDelete(menu.view)
              }}
            >
              <Trash2 size={14} aria-hidden />
              ビューを削除
            </button>
          </div>
        </Popover>
      )}
      {adding && (
        <Popover anchor={adding} onClose={() => setAdding(null)} width={220}>
          <div role="menu" className="p-1.5">
            <p className="px-2 pt-1 pb-1.5 text-sm text-ink-2">新しいビュー</p>
            <button type="button" role="menuitem" className={item} onClick={() => (setAdding(null), onAdd('list'))}>
              <Rows3 size={14} className="text-ink-2" aria-hidden />
              一覧
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!canKanban}
              title={canKanban ? undefined : '選択肢の項目が無いので、カンバンは作れません'}
              className={cx(item, 'disabled:opacity-50')}
              onClick={() => (setAdding(null), onAdd('kanban'))}
            >
              <SquareKanban size={14} className="text-ink-2" aria-hidden />
              カンバン
            </button>
          </div>
        </Popover>
      )}
    </div>
  )
}
