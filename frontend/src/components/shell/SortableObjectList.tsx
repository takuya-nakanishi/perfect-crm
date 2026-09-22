import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import type { ObjectMeta } from '@/api/types'
import { ObjectLink } from './ObjectLink'

function SortableLink(props: { object: ObjectMeta; index: number; active: boolean; onNavigate: () => void }) {
  const { ref, isDragSource } = useSortable({ id: props.object.key, index: props.index })
  return <ObjectLink {...props} dragRef={ref} dragging={isDragSource} />
}

/** サイドバーのテーブルの並べ替え(順番は G → n のキーにもそのまま効く) */
export function SortableObjectList({
  objects,
  activeKey,
  onNavigate,
  onReorder,
}: {
  objects: ObjectMeta[]
  activeKey: string | undefined
  onNavigate: () => void
  onReorder: (from: number, to: number) => void
}) {
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        const { source } = event.operation
        if (event.canceled || !isSortable(source)) return
        const { initialIndex, index } = source.sortable
        if (initialIndex !== index) onReorder(initialIndex, index)
      }}
    >
      {objects.map((o, i) => (
        <SortableLink key={o.key} object={o} index={i} active={o.key === activeKey} onNavigate={onNavigate} />
      ))}
    </DragDropProvider>
  )
}
