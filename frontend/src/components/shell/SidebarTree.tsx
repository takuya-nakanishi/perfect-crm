import { ChevronRight, Ellipsis, Pencil, Trash2 } from 'lucide-react'
import { useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MetaResponse, ObjectMeta, SidebarItem } from '@/api/types'
import { Popover } from '@/components/ui/overlay'
import { useSidebarMutations } from '@/data/sidebar'
import { cx } from '@/lib/cx'
import { addFolder, removeFolder, renameFolder, sidebarItems, sidebarObjects, type SidebarDrop } from '@/lib/sidebar'
import { useUI } from '@/state/ui'
import { ObjectLink, rowCls } from './ObjectLink'
import { DndHook, DropTarget } from './sidebarSlots'

export interface SidebarTreeProps {
  meta: MetaResponse
  /** いま開いているテーブル(お気に入りのビューを開いているときは無し) */
  activeKey: string | undefined
  /** 並べ替え・フォルダの作成と変更ができる(サイドバーはワークスペース共通なので管理者だけ) */
  admin: boolean
  /** 見出しの「フォルダを追加」を押した(先頭に名前の欄を出す) */
  creating: boolean
  onCreated: () => void
  onNavigate: () => void
}

const menuItem = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ink hover:bg-sunken'

/** 落とす先の線。行の境目に、その行の深さで引く(フォルダの中なら字下げして)。左端の丸で、指に付いてくる行の陰でも見つけられる */
function DropLine({ at, inFolder }: { at: 'before' | 'after'; inFolder?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx('pointer-events-none absolute right-1 z-10 flex h-2 items-center', at === 'before' ? '-top-1' : '-bottom-1', inFolder ? 'left-8' : 'left-1')}
    >
      <span className="size-2 flex-none rounded-full border-2 border-accent bg-chrome" />
      <span className="h-0.5 flex-1 bg-accent" />
    </span>
  )
}

/** 線を引く位置(この行・このフォルダの前か後ろ)。落とす先がここを指していなければ null */
function lineAt(drop: SidebarDrop | null, ref: { type: 'object'; key: string } | { type: 'folder'; id: string }): 'before' | 'after' | null {
  if (!drop || drop.kind === 'into' || drop.kind === 'end') return null
  const same = ref.type === 'object' ? drop.ref.type === 'object' && drop.ref.key === ref.key : drop.ref.type === 'folder' && drop.ref.id === ref.id
  return same ? drop.kind : null
}

function TableRow({ object, index, active, inFolder, editable, onNavigate }: { object: ObjectMeta; index: number; active: boolean; inFolder: boolean; editable: boolean; onNavigate: () => void }) {
  const useDnd = useContext(DndHook)
  // フォルダの中の行はフォルダを受けない(フォルダはフォルダの外にしか置けない)
  const { ref, dragging } = useDnd({ id: `object:${object.key}`, drag: { type: 'object', key: object.key }, zone: { zone: 'object', key: object.key }, accept: inFolder ? ['object'] : ['object', 'folder'] })
  const line = lineAt(useContext(DropTarget), { type: 'object', key: object.key })
  return (
    <div className="relative">
      <ObjectLink object={object} index={index} active={active} inFolder={inFolder} editable={editable} onNavigate={onNavigate} dragRef={ref} dragging={dragging} />
      {line && <DropLine at={line} inFolder={inFolder} />}
    </div>
  )
}

/** フォルダの名前の欄(作るとき・名前を変えるとき)。Enter か外れたときに確定、Esc でやめる。空ならやめる */
function FolderName({ initial, label, onDone }: { initial: string; label: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  // 最初の名前は選んだ状態で出す(打てばそのまま置き換わる)
  useLayoutEffect(() => {
    ref.current?.select()
  }, [])
  const finish = (name: string | null) => {
    if (done.current) return
    done.current = true
    onDone(name?.trim() || null)
  }
  return (
    <div className="flex h-8 items-center gap-2 px-2">
      <span className="grid size-5 flex-none place-items-center text-ink-3">
        <ChevronRight size={14} strokeWidth={2.25} className="rotate-90" aria-hidden />
      </span>
      <input
        ref={ref}
        autoFocus
        value={value}
        aria-label={label}
        placeholder="フォルダの名前"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            finish(value)
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            finish(null)
          }
        }}
        className="h-7 min-w-0 flex-1 rounded bg-paper px-1.5 text-base text-ink outline-none shadow-[inset_0_0_0_1.5px_var(--accent)]"
      />
    </div>
  )
}

/** 開いた空のフォルダに出す案内。テーブルを落とすとフォルダに入る */
function EmptyHint({ folder, admin }: { folder: string; admin: boolean }) {
  const useDnd = useContext(DndHook)
  const { ref } = useDnd({ id: `empty:${folder}`, zone: { zone: 'empty', id: folder }, accept: ['object'] })
  return (
    <p ref={ref} className="flex h-8 items-center pr-2 pl-9 text-sm text-ink-3">
      {admin ? 'テーブルをドラッグして入れる' : '空のフォルダ'}
    </p>
  )
}

/** 並びの下の余白。ここへ落とすと末尾(フォルダの外)に置く */
function EndZone() {
  const useDnd = useContext(DndHook)
  const { ref } = useDnd({ id: 'end', zone: { zone: 'end' }, accept: ['object', 'folder'] })
  const drop = useContext(DropTarget)
  return (
    <div ref={ref} className="relative h-8">
      {drop?.kind === 'end' && <DropLine at="before" />}
    </div>
  )
}

function FolderBlock({
  folder,
  objects,
  collapsed,
  activeKey,
  admin,
  renaming,
  onToggle,
  onMenu,
  onRenamed,
  renderRow,
}: {
  folder: Extract<SidebarItem, { type: 'folder' }>
  /** 中のテーブル(サイドバーに出すものだけ) */
  objects: ObjectMeta[]
  collapsed: boolean
  activeKey: string | undefined
  admin: boolean
  renaming: boolean
  onToggle: () => void
  onMenu: (anchor: HTMLElement) => void
  onRenamed: (name: string | null) => void
  renderRow: (object: ObjectMeta) => ReactNode
}) {
  const useDnd = useContext(DndHook)
  const drop = useContext(DropTarget)
  // 畳んでいても、いま開いているテーブルだけは見せる(どこにいるかを見失わない)
  const visible = collapsed ? objects.filter((o) => o.key === activeKey) : objects
  // 見出しのボタンでつまむ(中身ごと動く)。見出しはテーブルを受ける(真ん中に落とすとフォルダの中へ)。
  // 塊(見出し + 中身)はフォルダを受ける(フォルダはフォルダの外にしか置けないので、塊の前後だけ)
  const { ref: headerRef, dragging } = useDnd({
    id: `folder:${folder.id}`,
    drag: { type: 'folder', id: folder.id },
    zone: { zone: 'folder', id: folder.id, collapsed, first: collapsed ? undefined : visible[0]?.key },
    accept: ['object'],
  })
  const { ref: blockRef } = useDnd({ id: `block:${folder.id}`, zone: { zone: 'block', id: folder.id }, accept: ['folder'] })
  const line = lineAt(drop, { type: 'folder', id: folder.id })
  const into = drop?.kind === 'into' && drop.folder === folder.id

  return (
    <div ref={blockRef} className={cx('relative', dragging && 'opacity-35')}>
      <div className="group/folder relative">
        {renaming ? (
          <FolderName initial={folder.label} label="フォルダの名前" onDone={onRenamed} />
        ) : (
          <button
            ref={headerRef}
            type="button"
            aria-expanded={!collapsed}
            data-folder={folder.id}
            onClick={onToggle}
            onContextMenu={
              admin
                ? (e) => {
                    e.preventDefault()
                    onMenu(e.currentTarget)
                  }
                : undefined
            }
            title={admin ? 'ドラッグで並べ替え。右クリックでメニュー' : undefined}
            className={cx(
              rowCls,
              // 「⋯」が出ているあいだは、名前がその下に潜らないように空ける
              admin && 'group-hover/folder:pr-8 group-has-[:focus-visible]/folder:pr-8 [@media(hover:none)]:pr-8',
              into ? 'bg-accent-wash text-accent-ink shadow-[inset_0_0_0_1.5px_var(--accent)]' : 'text-ink-2 hover:bg-sunken hover:text-ink',
            )}
          >
            <span className="grid size-5 flex-none place-items-center text-ink-3">
              <ChevronRight size={14} strokeWidth={2.25} aria-hidden className={cx('transition-transform duration-150', !collapsed && 'rotate-90')} />
            </span>
            <span className="min-w-0 flex-1 truncate">{folder.label}</span>
            {/* 畳んでいるときだけ、中のテーブルの数(お気に入りの件数と同じ右端。「⋯」が出ているあいだは譲る) */}
            {collapsed && objects.length > 0 && (
              <span className={cx('flex-none text-sm text-ink-3 tabular-nums', admin && 'group-hover/folder:hidden group-has-[:focus-visible]/folder:hidden [@media(hover:none)]:hidden')}>
                {objects.length}
              </span>
            )}
          </button>
        )}
        {admin && !renaming && (
          <button
            type="button"
            aria-label={`フォルダ「${folder.label}」のメニュー`}
            title="フォルダのメニュー"
            onClick={(e) => onMenu(e.currentTarget)}
            className="absolute top-1 right-1 inline-grid size-6 place-items-center rounded-md text-ink-2 opacity-0 group-hover/folder:opacity-100 group-has-[:focus-visible]/folder:opacity-100 hover:bg-sunken hover:text-ink [@media(hover:none)]:opacity-100"
          >
            <Ellipsis size={15} aria-hidden />
          </button>
        )}
      </div>
      {visible.map(renderRow)}
      {!collapsed && objects.length === 0 && <EmptyHint folder={folder.id} admin={admin} />}
      {line && <DropLine at={line} />}
    </div>
  )
}

/**
 * サイドバーの「テーブル」(05 §13)。テーブルとフォルダを並びの順に描く。フォルダは押すと畳む・開く(端末ごとに覚える)。
 * つまんで動かす部品は SidebarDnd が差し込む(sidebarSlots)
 */
export function SidebarTree({ meta, activeKey, admin, creating, onCreated, onNavigate }: SidebarTreeProps) {
  const items = useMemo(() => sidebarItems(meta), [meta])
  // 1…9 のキーの案内。畳んだフォルダの中も数える(畳んでもキーの割り当てが変わらない)
  const order = useMemo(() => new Map(sidebarObjects(meta).map((o, i) => [o.key, i])), [meta])
  const byKey = useMemo(() => new Map(meta.objects.map((o) => [o.key, o])), [meta])
  const collapsed = useUI((s) => s.collapsedFolders)
  const toggleFolder = useUI((s) => s.toggleFolder)
  const { save } = useSidebarMutations()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null)

  const row = (object: ObjectMeta, inFolder: boolean) => (
    <TableRow key={object.key} object={object} index={order.get(object.key) ?? 99} active={object.key === activeKey} inFolder={inFolder} editable={admin} onNavigate={onNavigate} />
  )
  const menuFolder = menu ? items.find((i) => i.type === 'folder' && i.id === menu.id) : undefined

  return (
    <>
      {creating && (
        <FolderName
          initial="新しいフォルダ"
          label="新しいフォルダの名前"
          onDone={(name) => {
            onCreated()
            if (name) save(addFolder(items, { id: crypto.randomUUID(), label: name }))
          }}
        />
      )}
      {items.map((item) => {
        if (item.type === 'object') {
          const object = byKey.get(item.key)
          return object?.in_sidebar ? row(object, false) : null
        }
        return (
          <FolderBlock
            key={item.id}
            folder={item}
            objects={item.keys.flatMap((key) => {
              const object = byKey.get(key)
              return object?.in_sidebar ? [object] : []
            })}
            collapsed={collapsed.includes(item.id)}
            activeKey={activeKey}
            admin={admin}
            renaming={renaming === item.id}
            onToggle={() => toggleFolder(item.id)}
            onMenu={(anchor) => setMenu({ id: item.id, anchor })}
            onRenamed={(name) => {
              setRenaming(null)
              if (name && name !== item.label) save(renameFolder(items, item.id, name))
            }}
            renderRow={(object) => row(object, true)}
          />
        )
      })}
      {admin && <EndZone />}

      {menu && menuFolder?.type === 'folder' && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={200}>
          <div role="menu" className="p-1.5">
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              onClick={() => {
                setMenu(null)
                setRenaming(menuFolder.id)
              }}
            >
              <Pencil size={14} className="text-ink-2" aria-hidden />
              名前を変更
            </button>
            <button
              type="button"
              role="menuitem"
              title="中のテーブルは、フォルダがあった場所に残ります"
              className={cx(menuItem, 'text-danger hover:bg-danger-wash')}
              onClick={() => {
                setMenu(null)
                // 確認は挟まず「元に戻す」で守る(05 §5)。前の並びを送り直せば、同じ id のフォルダと中身が戻る
                save(removeFolder(items, menuFolder.id), { message: `フォルダ「${menuFolder.label}」を削除しました(中のテーブルは外へ)`, undo: items })
              }}
            >
              <Trash2 size={14} aria-hidden />
              フォルダを削除
            </button>
          </div>
        </Popover>
      )}
    </>
  )
}
