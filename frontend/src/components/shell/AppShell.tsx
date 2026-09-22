import { lazy, Suspense, useEffect, useRef } from 'react'
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router'
import type { MetaResponse, Session } from '@/api/types'
import { CreateRecordModal } from '@/components/record/CreateRecordModal'
import { RecordPanel } from '@/components/record/RecordPanel'
import { Toaster } from '@/components/ui/Toaster'
import { findObject, homePath, useMeta, useRecord, useSession, viewsOf } from '@/data/queries'
import { cx } from '@/lib/cx'
import { isPlainKey, isTyping, useKeydown } from '@/lib/hotkeys'
import { recordName } from '@/lib/records'
import { usePeek } from '@/lib/usePeek'
import { isOverlayOpen, useUI } from '@/state/ui'
import { CloverMark } from './CloverMark'
import { QuickAddTask } from './QuickAddTask'
import { SearchPalette } from './SearchPalette'
import { ShortcutsHelp } from './ShortcutsHelp'
import { Sidebar } from './Sidebar'

// テーブル設定と取り込みは、たまにしか開かないので別のファイルに分ける
const TableDesigner = lazy(() => import('@/components/designer/TableDesigner').then((m) => ({ default: m.TableDesigner })))
const ImportModal = lazy(() => import('@/components/designer/ImportModal').then((m) => ({ default: m.ImportModal })))

/** アプリ全体のキー操作。1 文字のキーは、文字を打っていないときだけ効く */
function useGlobalHotkeys(meta: MetaResponse) {
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const { peek } = usePeek()
  const peekObject = findObject(meta, peek?.object)
  const peeked = useRecord(peekObject?.key, peek?.id)
  const pendingG = useRef(0)

  useKeydown((e) => {
    const ui = useUI.getState()
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      ui.setPalette(!ui.paletteOpen)
      return
    }
    if (isTyping(e) || !isPlainKey(e) || isOverlayOpen()) return

    const objects = meta.objects.filter((o) => o.in_sidebar).sort((a, b) => a.position - b.position)
    const currentKey = /^\/o\/([^/]+)/.exec(location.pathname)?.[1]
    const current = findObject(meta, currentKey)
    const key = e.key.toLowerCase()

    // G に続く 1 打: テーブルやホームへ移動
    if (Date.now() - pendingG.current < 1200) {
      pendingG.current = 0
      if (key === 'h') {
        e.preventDefault()
        navigate(homePath(meta))
        return
      }
      if (/^[1-9]$/.test(key) && objects[Number(key) - 1]) {
        e.preventDefault()
        navigate(`/o/${objects[Number(key) - 1].key}`)
        return
      }
    }

    switch (key) {
      case 'g':
        pendingG.current = Date.now()
        return
      case 'q': {
        e.preventDefault()
        // レコードを開いているときは、それを関連先(または取引先責任者)に入れて開く
        const taskObject = meta.objects.find((o) => o.completion)
        const relatedField = taskObject?.fields.find((f) => f.type === 'polymorphic')
        if (peekObject && peeked.data) {
          const ref = { id: peeked.data.record.id, name: recordName(peekObject, peeked.data.record) }
          if (relatedField?.targets?.includes(peekObject.key)) return ui.openQuickAdd({ related: { object: peekObject.key, ref } })
          if (peekObject.key === 'contacts') return ui.openQuickAdd({ contact: ref })
        }
        return ui.openQuickAdd()
      }
      case '/':
        e.preventDefault()
        return ui.setPalette(true)
      case '?':
        e.preventDefault()
        return ui.setShortcuts(true)
      case 'm':
        e.preventDefault()
        return ui.toggleSidebar()
      case 'n':
        if (!current) return
        e.preventDefault()
        return current.completion ? ui.openQuickAdd() : ui.openCreate(current.key)
      case 'f': {
        // 絞り込み欄は開いているときだけ存在する。閉じていれば、開くボタンを押す(開くと同時にフォーカスが入る)
        const input = document.getElementById('table-filter')
        const toggle = document.getElementById('table-filter-toggle')
        if (!input && !toggle) return
        e.preventDefault()
        return input ? input.focus() : toggle?.click()
      }
      default: {
        if (!current || !/^[1-9]$/.test(key)) return
        const view = viewsOf(meta, current.key)[Number(key) - 1]
        if (!view || view.id === params.get('view')) return
        e.preventDefault()
        setParams((prev) => {
          const next = new URLSearchParams(prev)
          next.set('view', view.id)
          return next
        })
      }
    }
  })
}

function Shell({ meta, session }: { meta: MetaResponse; session: Session }) {
  useGlobalHotkeys(meta)
  const collapsed = useUI((s) => s.sidebarCollapsed)
  const mobileNavOpen = useUI((s) => s.mobileNavOpen)
  const setMobileNav = useUI((s) => s.setMobileNav)
  const paletteOpen = useUI((s) => s.paletteOpen)
  const shortcutsOpen = useUI((s) => s.shortcutsOpen)
  const quickAdd = useUI((s) => s.quickAdd)
  const createFor = useUI((s) => s.createFor)
  const designer = useUI((s) => s.designer)
  const importFor = useUI((s) => s.importFor)

  return (
    <div className="flex h-dvh overflow-hidden bg-paper text-ink">
      {/* 広い画面では左に固定。狭い画面では引き出し */}
      <div className={cx('hidden flex-none md:block', collapsed && 'md:hidden')}>
        <Sidebar meta={meta} session={session} />
      </div>
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 animate-fade-in bg-ink/25 dark:bg-black/55" onClick={() => setMobileNav(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 animate-fade-in shadow-pop">
            <Sidebar meta={meta} session={session} />
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <Outlet context={meta} />
      </main>

      <RecordPanel meta={meta} />
      {paletteOpen && <SearchPalette meta={meta} />}
      {quickAdd.open && <QuickAddTask meta={meta} seed={quickAdd.seed} />}
      {createFor && <CreateRecordModal meta={meta} objectKey={createFor.object} defaults={createFor.defaults} defaultRefs={createFor.refs} />}
      {shortcutsOpen && <ShortcutsHelp />}
      <Suspense fallback={null}>
        {designer && <TableDesigner key={designer.object ?? 'new'} meta={meta} target={designer} />}
        {importFor && <ImportModal meta={meta} objectKey={importFor} />}
      </Suspense>
      <Toaster />
    </div>
  )
}

function Splash() {
  return (
    <div className="grid h-dvh place-items-center bg-paper">
      <CloverMark size={36} animated />
    </div>
  )
}

/** ログイン済みなら外枠を描き、未ログインならログイン画面へ送る */
export function AppShell() {
  const session = useSession()
  const meta = useMeta(Boolean(session.data))
  const location = useLocation()
  const setMobileNav = useUI((s) => s.setMobileNav)

  useEffect(() => setMobileNav(false), [location.pathname, setMobileNav])

  if (session.isPending) return <Splash />
  if (!session.data) {
    const next = location.pathname === '/' ? '' : `?next=${encodeURIComponent(location.pathname + location.search)}`
    return <Navigate to={`/login${next}`} replace />
  }
  if (!meta.data) return <Splash />
  return <Shell meta={meta.data} session={session.data} />
}
