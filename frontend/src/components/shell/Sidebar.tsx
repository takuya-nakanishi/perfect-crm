import { useQueryClient } from '@tanstack/react-query'
import { ChevronsUpDown, Keyboard, LogOut, Monitor, Moon, PanelLeftClose, Plus, RotateCcw, Search, Settings, Sun } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { api, API_MODE } from '@/api/client'
import type { MetaResponse, Session, ViewMeta } from '@/api/types'
import { Avatar, IconButton, Kbd } from '@/components/ui/basics'
import { Popover } from '@/components/ui/overlay'
import { keys, useRecords, viewsOf } from '@/data/queries'
import { cx } from '@/lib/cx'
import { VIEW_ICONS } from '@/lib/icons'
import { useUI, type Theme } from '@/state/ui'
import { CloverMark } from './CloverMark'
import { ObjectLink, rowCls } from './ObjectLink'

const SortableObjectList = lazy(() => import('./SortableObjectList').then((m) => ({ default: m.SortableObjectList })))

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
  const qc = useQueryClient()
  const admin = Boolean(session.user.admin)
  const closeMobile = () => setMobileNav(false)

  /** 並びは先に画面へ当て(楽観更新)、サーバの応答で確定する。失敗したら戻す */
  const reorder = (from: number, to: number) => {
    const before = qc.getQueryData<MetaResponse>(keys.meta)
    const order = [...objects]
    order.splice(to, 0, ...order.splice(from, 1))
    const positions = new Map(order.map((o, i) => [o.key, i + 1]))
    qc.setQueryData<MetaResponse>(keys.meta, (old) =>
      old ? { ...old, objects: old.objects.map((o) => ({ ...o, position: positions.get(o.key) ?? o.position })) } : old,
    )
    api
      .reorderObjects(order.map((o) => o.key))
      .then((next) => qc.setQueryData(keys.meta, next))
      .catch(() => {
        if (before) qc.setQueryData(keys.meta, before)
        useUI.getState().toast({ message: '並びを保存できませんでした。もう一度試してください', tone: 'danger' })
      })
  }

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

        <div className="group/tables mt-3 flex items-center pt-1 pr-0.5">
          <h2 className="flex-1 px-2 py-1 text-sm text-ink-3">テーブル</h2>
          {/* ふだんは隠し、この見出しに触れたときだけ出す(キーボードのフォーカスと、ホバーの無い端末では常に出す) */}
          {admin && (
            <Link
              to="/settings/tables?new"
              aria-label="テーブルを追加"
              title="テーブルを追加(環境設定)"
              onClick={closeMobile}
              className="inline-grid size-6 place-items-center rounded-md text-ink-2 opacity-0 group-hover/tables:opacity-100 hover:bg-sunken hover:text-ink focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
            >
              <Plus size={15} />
            </Link>
          )}
        </div>
        {/* 並べ替えの部品(dnd-kit)は最初の表示に要らないので別ファイル。届くまでは同じ見た目の行を出す */}
        <Suspense fallback={objects.map((o, i) => <ObjectLink key={o.key} object={o} index={i} active={currentObject === o.key && !onPinnedView} onNavigate={closeMobile} />)}>
          <SortableObjectList objects={objects} activeKey={onPinnedView ? undefined : currentObject} onNavigate={closeMobile} onReorder={reorder} />
        </Suspense>
      </div>

      {admin && (
        <div className="flex-none border-t border-line p-2">
          <Link
            to="/settings"
            onClick={closeMobile}
            aria-current={location.pathname.startsWith('/settings') ? 'page' : undefined}
            className={cx(rowCls, location.pathname.startsWith('/settings') ? 'bg-accent-wash font-bold text-accent-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink')}
          >
            <Settings size={16} className="flex-none" aria-hidden />
            <span className="flex-1">環境設定</span>
          </Link>
        </div>
      )}
    </nav>
  )
}
