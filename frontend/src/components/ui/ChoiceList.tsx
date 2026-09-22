import { Check, Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '@/lib/cx'

export interface Choice {
  id: string
  node: ReactNode
  searchText: string
  selected: boolean
  commit: () => void
}

/** 矢印キーで動かして Enter で決める一覧。候補が多いときは上に絞り込み欄を出す */
export function ChoiceList({
  choices,
  query,
  onQuery,
  placeholder,
  loading,
  clear,
}: {
  choices: Choice[]
  query?: string
  onQuery?: (q: string) => void
  placeholder?: string
  loading?: boolean
  clear?: () => void
}) {
  const [active, setActive] = useState(() => Math.max(0, choices.findIndex((c) => c.selected)))
  const listRef = useRef<HTMLDivElement>(null)
  const index = Math.min(active, Math.max(0, choices.length - 1))

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  // 絞り込み欄が無いときは一覧そのものにフォーカスを当て、矢印キーを受ける
  const hasQuery = Boolean(onQuery)
  useEffect(() => {
    if (!hasQuery) listRef.current?.focus({ preventScroll: true })
  }, [hasQuery])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((index + 1) % Math.max(1, choices.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((index - 1 + choices.length) % Math.max(1, choices.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choices[index]?.commit()
    }
  }

  return (
    <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
      {onQuery ? (
        <label className="flex flex-none items-center gap-2 border-b border-line px-3">
          <Search size={14} className="flex-none text-ink-3" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              onQuery(e.target.value)
              setActive(0)
            }}
            placeholder={placeholder}
            className="h-9 w-full bg-transparent text-base outline-none placeholder:text-ink-3"
          />
        </label>
      ) : null}
      <div
        ref={listRef}
        role="listbox"
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto p-1 outline-none"
      >
        {choices.map((c, i) => (
          <button
            key={c.id}
            type="button"
            role="option"
            aria-selected={c.selected}
            data-active={i === index}
            tabIndex={-1}
            onPointerMove={() => setActive(i)}
            onClick={c.commit}
            className={cx(
              'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left',
              i === index && 'bg-sunken',
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">{c.node}</span>
            {c.selected && <Check size={14} className="flex-none text-accent" aria-hidden />}
          </button>
        ))}
        {choices.length === 0 && (
          <p className="px-2 py-3 text-sm text-ink-3">{loading ? '探しています…' : '当てはまるものがありません'}</p>
        )}
      </div>
      {clear && (
        <button
          type="button"
          onClick={clear}
          className="flex h-9 flex-none items-center gap-2 border-t border-line px-3 text-left text-sm text-ink-2 hover:bg-sunken"
        >
          <X size={13} aria-hidden />
          空にする
        </button>
      )}
    </div>
  )
}
