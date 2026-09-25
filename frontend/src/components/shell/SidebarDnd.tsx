import { DragDropProvider, DragOverlay, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/react'
import { ChevronRight } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { MetaResponse } from '@/api/types'
import { ObjectIcon } from '@/components/ui/basics'
import { useSidebarMutations } from '@/data/sidebar'
import { rowSensors } from '@/lib/dnd'
import { moveInSidebar, resolveDrop, sidebarItems, type DropZone, type SidebarDrop, type SidebarRef } from '@/lib/sidebar'
import { SidebarTree, type SidebarTreeProps } from './SidebarTree'
import { DndHook, DropTarget, type DndBind, type DndInput } from './sidebarSlots'

/**
 * 行をつまめるようにし、受け口にもする(同じ要素に両方を付ける)。
 * 使わない側は要素に結び付けない。無効のつまむ部品を結ぶと、dnd-kit が要素に aria-disabled="true" を付け、押せないボタンに見える
 */
function useSlot({ id, drag, zone, accept }: DndInput): DndBind {
  const draggable = useDraggable({ id: `drag:${id}`, type: drag?.type, disabled: !drag, data: { ref: drag } })
  const droppable = useDroppable({ id: `drop:${id}`, accept, disabled: !zone, data: { zone } })
  const setDrag = draggable.ref
  const setDrop = droppable.ref
  const draggableOn = Boolean(drag)
  const droppableOn = Boolean(zone)
  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (draggableOn) setDrag(el)
      if (droppableOn) setDrop(el)
    },
    [setDrag, setDrop, draggableOn, droppableOn],
  )
  return { ref, dragging: draggable.isDragSource }
}

// 指の少し右に、短く・少し透かして出す(真上に重ねると、落とす先の線を隠す)
const ghostCls = 'ml-10 flex h-8 w-max max-w-44 cursor-grabbing items-center gap-2 rounded-md bg-raised/90 px-2 text-base text-ink shadow-drag'

/** 指に付いてくる行(テーブルならアイコンと名前、フォルダなら名前と中の数) */
function Ghost({ meta, source }: { meta: MetaResponse; source: SidebarRef | undefined }) {
  if (source?.type === 'object') {
    const object = meta.objects.find((o) => o.key === source.key)
    if (!object) return null
    return (
      <div className={ghostCls}>
        <ObjectIcon icon={object.icon} color={object.color} size={14} />
        <span className="min-w-0 flex-1 truncate">{object.label}</span>
      </div>
    )
  }
  const folder = source && meta.folders.find((f) => f.id === source.id)
  if (!folder) return null
  const count = meta.objects.filter((o) => o.folder_id === folder.id && o.in_sidebar).length
  return (
    <div className={ghostCls}>
      <span className="grid size-5 flex-none place-items-center text-ink-3">
        <ChevronRight size={14} strokeWidth={2.25} aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate">{folder.label}</span>
      {count > 0 && <span className="flex-none text-sm text-ink-3 tabular-nums">{count}</span>}
    </div>
  )
}

type Operation = DragEndEvent['operation']

/**
 * サイドバーのドラッグ(05 §13。Notion のサイドバーの型)。行は動かさず、指に付いてくる行と、落とす先の線(フォルダの中なら囲み)を出す。
 * 落とす先は、指が乗っている行と、その行の中の高さで決める(lib/sidebar.ts の resolveDrop)。離したら並びを全量で保存する
 */
export function SidebarDnd(props: SidebarTreeProps) {
  const { meta } = props
  const items = useMemo(() => sidebarItems(meta), [meta])
  const { save } = useSidebarMutations()
  const [drop, setDrop] = useState<SidebarDrop | null>(null)
  // 指を動かすたびに描き直さない(落とす先が変わったときだけ)
  const shown = useRef('null')
  const show = (next: SidebarDrop | null) => {
    const key = JSON.stringify(next)
    if (key === shown.current) return
    shown.current = key
    setDrop(next)
  }

  /** 落とす先。動かしても並びが変わらない場所(自分の前後など)は null(線を出さない) */
  const resolve = (operation: Operation, point = operation.position.current): { source: SidebarRef; drop: SidebarDrop } | null => {
    const source = operation.source?.data?.ref as SidebarRef | undefined
    const zone = operation.target?.data?.zone as DropZone | undefined
    const el = operation.target?.element
    if (!source || !zone || !el) return null
    const rect = el.getBoundingClientRect()
    const ratio = rect.height > 0 ? Math.min(1, Math.max(0, (point.y - rect.top) / rect.height)) : 0.5
    const next = resolveDrop(zone, ratio)
    return moveInSidebar(items, source, next) ? { source, drop: next } : null
  }

  return (
    <DragDropProvider
      sensors={rowSensors}
      onDragMove={(event) => show(resolve(event.operation, event.to)?.drop ?? null)}
      onDragOver={(event) => show(resolve(event.operation)?.drop ?? null)}
      onDragEnd={(event) => {
        show(null)
        if (event.canceled) return
        const found = resolve(event.operation)
        const next = found && moveInSidebar(items, found.source, found.drop)
        if (next) save(next)
      }}
    >
      <DndHook.Provider value={useSlot}>
        <DropTarget.Provider value={drop}>
          <SidebarTree {...props} />
        </DropTarget.Provider>
      </DndHook.Provider>
      <DragOverlay dropAnimation={null}>{(source) => <Ghost meta={meta} source={source.data?.ref as SidebarRef | undefined} />}</DragOverlay>
    </DragDropProvider>
  )
}
