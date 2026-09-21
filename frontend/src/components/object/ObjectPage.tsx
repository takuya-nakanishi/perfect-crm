import { ListFilter, Menu, PanelLeft, Plus, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router'
import type { MetaResponse } from '@/api/types'
import { Button, IconButton, Kbd, ObjectIcon } from '@/components/ui/basics'
import { findObject, viewsOf } from '@/data/queries'
import { cx } from '@/lib/cx'
import { VIEW_ICONS } from '@/lib/icons'
import { useDebounced } from '@/lib/useDebounced'
import { useUI } from '@/state/ui'
import { ListView } from './ListView'

// カンバン(ドラッグ&ドロップのライブラリを含む)とレポートは、最初の表示に要らないので別のファイルに分ける。
// 開いてすぐ裏で読み込んでおくので、タブを切り替えたときには手元にある
const loadKanban = () => import('./KanbanView')
const loadReport = () => import('./ReportView')
const KanbanView = lazy(() => loadKanban().then((m) => ({ default: m.KanbanView })))
const ReportView = lazy(() => loadReport().then((m) => ({ default: m.ReportView })))

/** テーブル 1 つぶんの画面。上にビューのタブ、下に選んだビュー(一覧・カンバン・レポート) */
export function ObjectPage({ meta }: { meta: MetaResponse }) {
  const { objectKey } = useParams()
  const [params, setParams] = useSearchParams()
  const [filterText, setFilterText] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const q = useDebounced(filterText.trim(), 150)
  const sidebarCollapsed = useUI((s) => s.sidebarCollapsed)
  const toggleSidebar = useUI((s) => s.toggleSidebar)
  const setMobileNav = useUI((s) => s.setMobileNav)
  const openCreate = useUI((s) => s.openCreate)
  const openQuickAdd = useUI((s) => s.openQuickAdd)

  useEffect(() => {
    const t = setTimeout(() => {
      void loadKanban()
      void loadReport()
    }, 800)
    return () => clearTimeout(t)
  }, [])

  const object = findObject(meta, objectKey)
  if (!object) return <Navigate to="/" replace />

  const views = viewsOf(meta, object.key)
  const view = views.find((v) => v.id === params.get('view')) ?? views[0]
  const isTasks = Boolean(object.completion)

  const selectView = (id: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('view', id)
      return next
    })
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex-none border-b border-line">
        <div className="flex h-12 items-center gap-2 pr-3 pl-3 md:pl-5">
          <IconButton label="メニューを開く" className="md:hidden" onClick={() => setMobileNav(true)}>
            <Menu size={17} />
          </IconButton>
          {sidebarCollapsed && (
            <IconButton label="サイドバーを開く (M)" className="hidden md:inline-grid" onClick={toggleSidebar}>
              <PanelLeft size={16} />
            </IconButton>
          )}
          <ObjectIcon icon={object.icon} color={object.color} size={16} />
          <h1 className="truncate text-lg font-bold">{object.label}</h1>

          <div className="ml-auto flex items-center gap-1.5">
            {/*
              絞り込み欄は、開いたときにだけ描く。幅を 0 から広げる作りにすると、広がりきる前の打鍵で
              Chromium がキャレットを先頭に置き続け、文字が逆順に入る(F を押してすぐ打つと起きた)
            */}
            {view?.type !== 'report' && !filterOpen && !filterText && (
              <IconButton id="table-filter-toggle" label="このテーブルを絞り込む (F)" className="size-8" onClick={() => setFilterOpen(true)}>
                <ListFilter size={15} />
              </IconButton>
            )}
            {view?.type !== 'report' && (filterOpen || filterText) && (
              <label className="flex h-8 w-44 items-center gap-1.5 rounded-md pr-1 pl-2 text-ink-2 shadow-[inset_0_0_0_1px_var(--line-strong)] focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)] sm:w-56">
                <ListFilter size={15} className="flex-none" aria-hidden />
                <input
                  id="table-filter"
                  autoFocus
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  onBlur={() => setFilterOpen(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
                      e.stopPropagation()
                      setFilterText('')
                      e.currentTarget.blur()
                    }
                  }}
                  placeholder={`${object.label}を絞り込む`}
                  aria-label={`${object.label}を絞り込む`}
                  className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
                />
                {filterText && (
                  <button
                    type="button"
                    aria-label="絞り込みを空にする"
                    onClick={() => setFilterText('')}
                    className="grid size-6 flex-none place-items-center rounded hover:bg-sunken"
                  >
                    <X size={13} />
                  </button>
                )}
              </label>
            )}
            <Button variant="primary" size="sm" onClick={() => (isTasks ? openQuickAdd() : openCreate(object.key))}>
              <Plus size={14} strokeWidth={2.5} aria-hidden />
              <span className="hidden sm:inline">{isTasks ? 'タスクを追加' : '新規'}</span>
              <span className="hidden opacity-80 lg:inline">
                <Kbd>{isTasks ? 'Q' : 'N'}</Kbd>
              </span>
            </Button>
          </div>
        </div>

        <div role="tablist" aria-label="ビュー" className="flex gap-0.5 overflow-x-auto px-3 md:px-4">
          {views.map((v, i) => {
            const Icon = VIEW_ICONS[v.type]
            const active = v.id === view?.id
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={i < 9 ? `${v.name} (${i + 1})` : v.name}
                onClick={() => selectView(v.id)}
                className={cx(
                  'relative flex h-9 flex-none items-center gap-1.5 rounded-t-md px-2.5 text-base whitespace-nowrap transition-colors duration-100',
                  active ? 'font-bold text-ink' : 'text-ink-2 hover:text-ink',
                )}
              >
                <Icon size={15} className={active ? 'text-accent' : undefined} aria-hidden />
                {v.name}
                {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" aria-hidden />}
              </button>
            )
          })}
        </div>
      </header>

      {view?.type === 'list' && <ListView key={view.id} meta={meta} object={object} config={view.config} q={q} viewName={view.name} />}
      <Suspense fallback={null}>
        {view?.type === 'kanban' && <KanbanView key={view.id} meta={meta} object={object} config={view.config} q={q} viewName={view.name} />}
        {view?.type === 'report' && <ReportView key={view.id} object={object} config={view.config} />}
      </Suspense>
    </div>
  )
}
