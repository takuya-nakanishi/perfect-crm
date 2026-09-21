import { Plus } from 'lucide-react'
import type { ObjectMeta } from '@/api/types'
import { Button, Kbd, ObjectIcon } from '@/components/ui/basics'
import { useUI } from '@/state/ui'

/** 空のビュー。次に何をすればよいかを示す */
export function EmptyState({ object, viewName, filtered }: { object: ObjectMeta; viewName: string; filtered: boolean }) {
  const openCreate = useUI((s) => s.openCreate)
  const openQuickAdd = useUI((s) => s.openQuickAdd)
  const isTasks = Boolean(object.completion)
  return (
    <div className="grid flex-1 place-items-center p-8">
      <div className="flex max-w-sm flex-col items-center text-center">
        <ObjectIcon icon={object.icon} color={object.color} size={26} />
        <h2 className="mt-4 text-lg font-bold">
          {filtered ? `当てはまる${object.label}はありません` : isTasks ? `「${viewName}」のタスクはありません` : `${object.label}はまだありません`}
        </h2>
        <p className="mt-1 text-ink-2">
          {filtered
            ? '絞り込みの言葉を変えるか、空にしてください。'
            : isTasks
              ? 'すべて片付いています。次のタスクはいつでも追加できます。'
              : `最初の${object.label}を登録しましょう。`}
        </p>
        {!filtered && (
          <Button variant="primary" className="mt-5" onClick={() => (isTasks ? openQuickAdd() : openCreate(object.key))}>
            <Plus size={15} strokeWidth={2.5} aria-hidden />
            {isTasks ? 'タスクを追加' : `${object.label}を作成`}
            <span className="ml-1 opacity-80">
              <Kbd>{isTasks ? 'Q' : 'N'}</Kbd>
            </span>
          </Button>
        )}
      </div>
    </div>
  )
}
