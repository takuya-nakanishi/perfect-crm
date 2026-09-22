import { Menu, PanelLeft } from 'lucide-react'
import { Navigate, NavLink, Outlet, useOutletContext } from 'react-router'
import type { MetaResponse } from '@/api/types'
import { IconButton } from '@/components/ui/basics'
import { useSession } from '@/data/queries'
import { cx } from '@/lib/cx'
import { useUI } from '@/state/ui'
import { SETTINGS_SECTIONS } from './sections'

/**
 * 環境設定。テーブルごとの設定ではなく、ワークスペース全体に効くもの。管理者だけが開ける(03 §5)。
 * 左に節、右に本文。狭い画面では節を上に横並び
 */
export function SettingsPage() {
  const meta = useOutletContext<MetaResponse>()
  const session = useSession()
  const sidebarCollapsed = useUI((s) => s.sidebarCollapsed)
  const toggleSidebar = useUI((s) => s.toggleSidebar)
  const setMobileNav = useUI((s) => s.setMobileNav)
  if (session.data && !session.data.user.admin) return <Navigate to="/" replace />

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-12 flex-none items-center gap-2 border-b border-line pr-3 pl-3 md:pl-5">
        <IconButton label="メニューを開く" className="md:hidden" onClick={() => setMobileNav(true)}>
          <Menu size={17} />
        </IconButton>
        {sidebarCollapsed && (
          <IconButton label="サイドバーを開く (M)" className="hidden md:inline-grid" onClick={toggleSidebar}>
            <PanelLeft size={16} />
          </IconButton>
        )}
        <h1 className="truncate text-lg font-bold">環境設定</h1>
        <span className="hidden text-sm text-ink-3 sm:inline">{meta.workspace.name} 全体に効く設定。管理者だけが変えられます</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="環境設定の節" className="flex flex-none gap-1 overflow-x-auto border-b border-line p-2 md:w-56 md:flex-col md:border-r md:border-b-0 md:p-3">
          {SETTINGS_SECTIONS.map((s) => (
            <NavLink
              key={s.path}
              to={`/settings/${s.path}`}
              className={({ isActive }) =>
                cx('flex h-9 flex-none items-center gap-2 rounded-md px-2.5 text-base whitespace-nowrap', isActive ? 'bg-accent-wash font-bold text-accent-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink')
              }
            >
              <s.icon size={16} aria-hidden />
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <Outlet context={meta} />
        </div>
      </div>
    </div>
  )
}

/** 節の見出し。本文の上に、名前と一言 */
export function SectionHeader({ title, hint, children }: { title: string; hint: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-3 px-5 pt-6 pb-4 md:px-8">
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="mt-0.5 text-ink-2">{hint}</p>
      </div>
      {children}
    </header>
  )
}
