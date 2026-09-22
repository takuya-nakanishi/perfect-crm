import { forwardRef, useImperativeHandle, useState } from 'react'
import type { MetaResponse, SearchHit } from '@/api/types'
import { ObjectIcon } from '@/components/ui/basics'
import { cx } from '@/lib/cx'

export interface MentionListHandle {
  onKeyDown(e: KeyboardEvent): boolean
}

/** @ に続けて打った文字で探した候補。↑↓ で動かし、Enter か Tab で決める(Tiptap の suggestion から呼ばれる) */
export const MentionList = forwardRef<
  MentionListHandle,
  { meta: MetaResponse; items: SearchHit[]; query: string; command: (item: { id: string; label: string }) => void }
>(function MentionList({ meta, items, query, command }, ref) {
  const [active, setActive] = useState(0)
  const [seen, setSeen] = useState(items)
  if (seen !== items) {
    // 候補が入れ替わったら先頭へ(描画中に state を直す、React の公式の書き方)
    setSeen(items)
    setActive(0)
  }
  const index = Math.min(active, Math.max(0, items.length - 1))
  const pick = (hit: SearchHit | undefined) => hit && command({ id: `${hit.object}:${hit.id}`, label: hit.name })

  useImperativeHandle(ref, () => ({
    onKeyDown(e) {
      if (e.isComposing) return false
      if (e.key === 'ArrowDown') {
        setActive((index + 1) % Math.max(1, items.length))
        return true
      }
      if (e.key === 'ArrowUp') {
        setActive((index - 1 + items.length) % Math.max(1, items.length))
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        pick(items[index])
        return true
      }
      return false
    },
  }))

  return (
    <div role="listbox" aria-label="言及するレコード" className="w-[300px] p-1">
      {items.length === 0 && <p className="px-2 py-2 text-sm text-ink-3">{query ? '当てはまるレコードがありません' : 'レコードの名前を打つ'}</p>}
      {items.map((hit, i) => {
        const object = meta.objects.find((o) => o.key === hit.object)
        return (
          <button
            key={`${hit.object}:${hit.id}`}
            type="button"
            role="option"
            aria-selected={i === index}
            tabIndex={-1}
            onPointerMove={() => setActive(i)}
            // エディタからフォーカスを奪わない
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(hit)}
            className={cx('flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left', i === index && 'bg-sunken')}
          >
            {object && <ObjectIcon icon={object.icon} color={object.color} size={12} />}
            <span className="min-w-0 flex-1 truncate">{hit.name}</span>
            <span className="flex-none text-xs text-ink-3">{object?.label ?? hit.object}</span>
          </button>
        )
      })}
    </div>
  )
})
