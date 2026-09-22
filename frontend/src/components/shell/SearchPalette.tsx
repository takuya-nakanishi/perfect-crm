import { CornerDownLeft, Keyboard, Moon, Plus, Search, Settings, SlidersHorizontal, Sun, Table2, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { MetaResponse } from '@/api/types'
import { Kbd, ObjectIcon } from '@/components/ui/basics'
import { Modal } from '@/components/ui/overlay'
import { useSearch, useSession } from '@/data/queries'
import { cx } from '@/lib/cx'
import { VIEW_ICONS } from '@/lib/icons'
import { useDebounced } from '@/lib/useDebounced'
import { usePeek } from '@/lib/usePeek'
import { useUI } from '@/state/ui'

interface Item {
  id: string
  group: string
  icon: ReactNode
  label: string
  hint?: string
  kbd?: string
  run: () => void
}

function CommandIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="grid size-[22px] flex-none place-items-center text-ink-2">
      <Icon size={16} aria-hidden />
    </span>
  )
}

/** 検索とコマンド( / または Ctrl+K)。レコードを探す、画面を移る、操作を呼ぶ、を 1 つの欄で */
export function SearchPalette({ meta }: { meta: MetaResponse }) {
  const close = () => useUI.getState().setPalette(false)
  const navigate = useNavigate()
  const { openPeek } = usePeek()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const q = useDebounced(query.trim(), 80)
  const { data, isFetching } = useSearch(q)
  const listRef = useRef<HTMLDivElement>(null)

  const currentKey = /^\/o\/([^/]+)/.exec(useLocation().pathname)?.[1]
  const admin = Boolean(useSession().data?.user.admin)
  const commands: Item[] = useMemo(() => {
    const ui = useUI.getState()
    const objects = meta.objects.filter((o) => o.in_sidebar).sort((a, b) => a.position - b.position)
    const pinned = meta.views.filter((v) => v.pin).sort((a, b) => (a.pin?.position ?? 0) - (b.pin?.position ?? 0))
    const dark = document.documentElement.dataset.theme === 'dark'
    return [
      ...pinned.map((v): Item => {
        const Icon = VIEW_ICONS[v.type]
        return {
          id: `view:${v.id}`,
          group: '移動',
          icon: <CommandIcon icon={Icon} />,
          label: v.pin?.label ?? v.name,
          run: () => navigate(`/o/${v.object}?view=${v.id}`),
        }
      }),
      ...objects.map(
        (o, i): Item => ({
          id: `object:${o.key}`,
          group: '移動',
          icon: <ObjectIcon icon={o.icon} color={o.color} size={16} />,
          label: o.label,
          kbd: `G ${i + 1}`,
          run: () => navigate(`/o/${o.key}`),
        }),
      ),
      { id: 'task:add', group: '操作', icon: <CommandIcon icon={Plus} />, label: 'タスクを追加', kbd: 'Q', run: () => ui.openQuickAdd() },
      ...objects
        .filter((o) => !o.completion)
        .map(
          (o): Item => ({
            id: `create:${o.key}`,
            group: '操作',
            icon: <CommandIcon icon={Plus} />,
            label: `${o.label}を作成`,
            run: () => ui.openCreate(o.key),
          }),
        ),
      ...(admin ? [{ id: 'settings', group: '移動', icon: <CommandIcon icon={Settings} />, label: '環境設定', run: () => navigate('/settings') } satisfies Item] : []),
      ...(admin ? [{ id: 'table:add', group: '操作', icon: <CommandIcon icon={Table2} />, label: 'テーブルを追加', run: () => navigate('/settings/tables?new') } satisfies Item] : []),
      // テーブル設定は、いま開いているテーブルのものだけを出す(全テーブル分を並べると一覧が長くなる)
      ...objects
        .filter((o) => admin && o.key === currentKey)
        .map(
          (o): Item => ({
            id: `settings:${o.key}`,
            group: '操作',
            icon: <CommandIcon icon={SlidersHorizontal} />,
            label: `${o.label}のテーブル設定`,
            run: () => navigate(`/settings/tables?object=${o.key}`),
          }),
        ),
      {
        id: 'theme',
        group: '操作',
        icon: <CommandIcon icon={dark ? Sun : Moon} />,
        label: dark ? 'ライトモードにする' : 'ダークモードにする',
        run: () => ui.setTheme(dark ? 'light' : 'dark'),
      },
      { id: 'shortcuts', group: '操作', icon: <CommandIcon icon={Keyboard} />, label: 'ショートカットの一覧', kbd: '?', run: () => ui.setShortcuts(true) },
    ]
  }, [meta, navigate, currentKey, admin])

  const items: Item[] = useMemo(() => {
    if (!q) return commands
    const needle = q.toLowerCase()
    const hits: Item[] = (data?.hits ?? []).flatMap((h) => {
      const o = meta.objects.find((x) => x.key === h.object)
      if (!o) return []
      return {
        id: `${h.object}:${h.id}`,
        group: o.label,
        icon: <ObjectIcon icon={o.icon} color={o.color} size={16} />,
        label: h.name,
        hint: h.subtitle ?? undefined,
        run: () => openPeek(h.object, h.id),
      }
    })
    return [...hits, ...commands.filter((c) => c.label.toLowerCase().includes(needle))]
  }, [q, data, commands, meta, openPeek])

  const index = Math.min(active, Math.max(0, items.length - 1))
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const run = (item: Item | undefined) => {
    if (!item) return
    close()
    item.run()
  }

  return (
    <Modal label="検索とコマンド" onClose={close} position="top" className="max-w-[620px]">
      <div
        className="flex min-h-0 flex-col"
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
            e.preventDefault()
            setActive((index + 1) % Math.max(1, items.length))
          } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
            e.preventDefault()
            setActive((index - 1 + items.length) % Math.max(1, items.length))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            run(items[index])
          }
        }}
      >
        <label className="flex h-13 flex-none items-center gap-3 border-b border-line px-4">
          <Search size={18} className={cx('flex-none', isFetching ? 'text-accent' : 'text-ink-3')} aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            placeholder="取引先・人・商談・タスクを探す、または操作を入力"
            aria-label="検索"
            className="h-13 w-full bg-transparent text-lg text-ink outline-none placeholder:text-ink-3"
          />
        </label>

        <div ref={listRef} role="listbox" className="max-h-[min(56vh,440px)] min-h-0 flex-1 overflow-y-auto p-1.5">
          {items.map((item, i) => (
            <div key={item.id}>
              {(i === 0 || items[i - 1].group !== item.group) && <p className="px-2.5 pt-2 pb-1 text-sm text-ink-3">{item.group}</p>}
              <button
                type="button"
                role="option"
                aria-selected={i === index}
                data-active={i === index}
                tabIndex={-1}
                onPointerMove={() => setActive(i)}
                onClick={() => run(item)}
                className={cx('flex h-10 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left', i === index && 'bg-sunken')}
              >
                {item.icon}
                <span className="min-w-0 truncate text-ink">{item.label}</span>
                {item.hint && <span className="min-w-0 flex-1 truncate text-sm text-ink-3">{item.hint}</span>}
                {item.kbd && (
                  <span className="ml-auto flex flex-none gap-1">
                    {item.kbd.split(' ').map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                )}
              </button>
            </div>
          ))}
          {items.length === 0 && (
            <p className="px-3 py-8 text-center text-ink-2">
              「{q}」に当てはまるものはありません。
              <br />
              <span className="text-sm text-ink-3">社名の一部、フリガナ、メールアドレスでも探せます。</span>
            </p>
          )}
        </div>

        <footer className="hidden flex-none items-center gap-4 border-t border-line bg-chrome px-4 py-2 text-sm text-ink-2 sm:flex">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            選ぶ
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>
              <CornerDownLeft size={10} aria-label="Enter" />
            </Kbd>
            開く
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Esc</Kbd>
            閉じる
          </span>
        </footer>
      </div>
    </Modal>
  )
}
