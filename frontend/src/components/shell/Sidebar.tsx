import { useQueryClient } from '@tanstack/react-query'
import { ChevronsUpDown, Keyboard, LogOut, Monitor, Moon, PanelLeftClose, Plus, RotateCcw, Search, Sun } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { api, API_MODE } from '@/api/client'
import type { MetaResponse, Session, ViewMeta } from '@/api/types'
import { Avatar, IconButton, Kbd, ObjectIcon } from '@/components/ui/basics'
import { Popover } from '@/components/ui/overlay'
import { useRecords, viewsOf } from '@/data/queries'
import { cx } from '@/lib/cx'
import { VIEW_ICONS } from '@/lib/icons'
import { useUI, type Theme } from '@/state/ui'
import { CloverMark } from './CloverMark'

const rowCls = 'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-base transition-colors duration-100'

function PinnedLink({ view, active, onNavigate }: { view: ViewMeta; active: boolean; onNavigate: () => void }) {
  const Icon = VIEW_ICONS[view.type]
  const filter = view.type === 'report' ? undefined : view.config.filter
  // 件数だけ欲しいので limit 0(サーバは total だけ数えて返す)
  const count = useRecords(view.object, { filter, limit: 0 }, Boolean(view.pin?.show_count))
  return (
    <Link
      to={`/o/${view.object}?view=${view.id}`}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cx(rowCls, active ? 'bg-accent-wash font-bold text-accent-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink')}
    >
      <Icon size={16} className="flex-none" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{view.pin?.label ?? view.name}</span>
      {view.pin?.show_count && count.data && count.data.total > 0 && (
        <span className={cx('flex-none text-sm tabular-nums', active ? 'text-accent-ink' : 'text-ink-3')}>{count.data.total}</span>
      )}
    </Link>
  )
}

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'ライト', icon: Sun },
  { value: 'dark', label: 'ダーク', icon: Moon },
  { value: 'system', label: '自動', icon: Monitor },
]

function WorkspaceMenu({ session }: { session: Session }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const theme = useUI((s) => s.theme)
  const setTheme = useUI((s) => s.setTheme)
  const setShortcuts = useUI((s) => s.setShortcuts)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const itemCls = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ink hover:bg-sunken'

  return (
    <>
      <button
        type="button"
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left hover:bg-sunken"
      >
        <CloverMark size={20} />
        <span className="min-w-0 flex-1 truncate font-bold">{session.workspace.name}</span>
        <ChevronsUpDown size={14} className="flex-none text-ink-3" aria-hidden />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={264}>
          <div className="flex items-center gap-2.5 border-b border-line px-3 py-3">
            <Avatar name={session.user.name} color={session.user.avatar_color} size={28} />
            <div className="min-w-0">
              <p className="truncate font-bold">{session.user.name}</p>
              <p className="truncate text-sm text-ink-2">{session.user.email}</p>
            </div>
          </div>
          <div className="border-b border-line p-1.5">
            <p className="px-2 pt-1 pb-1.5 text-sm text-ink-2">外観</p>
            <div className="grid grid-cols-3 gap-1 px-1 pb-1" role="radiogroup" aria-label="外観">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={theme === t.value}
                  onClick={() => setTheme(t.value)}
                  className={cx(
                    'flex h-8 items-center justify-center gap-1.5 rounded-md text-sm',
                    theme === t.value ? 'bg-accent-wash font-bold text-accent-ink' : 'text-ink-2 hover:bg-sunken',
                  )}
                >
                  <t.icon size={14} aria-hidden />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="p-1.5">
            <button
              type="button"
              className={itemCls}
              onClick={() => {
                setAnchor(null)
                setShortcuts(true)
              }}
            >
              <Keyboard size={15} className="text-ink-2" aria-hidden />
              <span className="flex-1">ショートカット</span>
              <Kbd>?</Kbd>
            </button>
            {API_MODE === 'mock' && (
              <button
                type="button"
                className={itemCls}
                onClick={async () => {
                  const { resetMockData } = await import('@/mocks/mockClient')
                  resetMockData()
                  await qc.invalidateQueries()
                  setAnchor(null)
                  useUI.getState().toast({ message: 'モックのデータを初期状態に戻しました' })
                }}
              >
                <RotateCcw size={15} className="text-ink-2" aria-hidden />
                モックのデータを初期化
              </button>
            )}
            <button
              type="button"
              className={itemCls}
              onClick={async () => {
                await api.logout()
                qc.clear()
                navigate('/login', { replace: true })
              }}
            >
              <LogOut size={15} className="text-ink-2" aria-hidden />
              ログアウト
            </button>
          </div>
        </Popover>
      )}
    </>
  )
}

export function Sidebar({ meta, session }: { meta: MetaResponse; session: Session }) {
  const location = useLocation()
  const [params] = useSearchParams()
  const setPalette = useUI((s) => s.setPalette)
  const openQuickAdd = useUI((s) => s.openQuickAdd)
  const toggleSidebar = useUI((s) => s.toggleSidebar)
  const setMobileNav = useUI((s) => s.setMobileNav)
  const closeMobile = () => setMobileNav(false)

  const objects = meta.objects.filter((o) => o.in_sidebar).sort((a, b) => a.position - b.position)
  const pinned = meta.views.filter((v) => v.pin).sort((a, b) => (a.pin?.position ?? 0) - (b.pin?.position ?? 0))
  const currentObject = /^\/o\/([^/]+)/.exec(location.pathname)?.[1]
  const currentView = currentObject ? (params.get('view') ?? viewsOf(meta, currentObject)[0]?.id) : undefined
  const onPinnedView = pinned.some((v) => v.id === currentView)

  return (
    <nav aria-label="メイン" className="flex h-full w-60 flex-col border-r border-line bg-chrome">
      <div className="flex flex-none items-center gap-1 p-2">
        <WorkspaceMenu session={session} />
        <IconButton label="サイドバーを畳む (M)" onClick={toggleSidebar} className="hidden md:inline-grid">
          <PanelLeftClose size={16} />
        </IconButton>
      </div>

      <div className="flex-none px-2">
        <button type="button" onClick={() => setPalette(true)} className={cx(rowCls, 'text-ink-2 hover:bg-sunken hover:text-ink')}>
          <Search size={16} className="flex-none" aria-hidden />
          <span className="flex-1">検索</span>
          <Kbd>/</Kbd>
        </button>
        <button type="button" onClick={() => openQuickAdd()} className={cx(rowCls, 'font-bold text-accent-ink hover:bg-accent-wash')}>
          <span className="grid size-4 flex-none place-items-center rounded-full bg-accent text-on-accent">
            <Plus size={12} strokeWidth={3} aria-hidden />
          </span>
          <span className="flex-1">タスクを追加</span>
          <Kbd>Q</Kbd>
        </button>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <h2 className="px-2 pt-2 pb-1 text-sm text-ink-3">お気に入り</h2>
        {pinned.map((view) => (
          <PinnedLink key={view.id} view={view} active={view.id === currentView} onNavigate={closeMobile} />
        ))}

        <h2 className="mt-3 px-2 pt-2 pb-1 text-sm text-ink-3">テーブル</h2>
        {objects.map((o, i) => {
          const active = currentObject === o.key && !onPinnedView
          return (
            <Link
              key={o.key}
              to={`/o/${o.key}`}
              onClick={closeMobile}
              aria-current={active ? 'page' : undefined}
              title={`G → ${i + 1}`}
              className={cx(rowCls, active ? 'bg-accent-wash font-bold text-accent-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink')}
            >
              <ObjectIcon icon={o.icon} color={o.color} size={14} />
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
