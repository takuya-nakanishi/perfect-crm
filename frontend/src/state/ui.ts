import { create } from 'zustand'
import type { RefRecord, Scalar } from '@/api/types'

export type Theme = 'light' | 'dark' | 'system'

export interface Toast {
  id: number
  message: string
  tone?: 'default' | 'danger'
  action?: { label: string; run: () => void }
}

/** タスクの追加欄を開くときに、最初から入れておく関連先と取引先責任者 */
export interface QuickAddSeed {
  related?: { object: string; ref: RefRecord }
  contact?: RefRecord
}

interface UIState {
  theme: Theme
  sidebarCollapsed: boolean
  mobileNavOpen: boolean
  paletteOpen: boolean
  shortcutsOpen: boolean
  quickAdd: { open: boolean; seed: QuickAddSeed }
  /** refs は「列名 → 参照先の表示情報」。defaults に入れた参照の名前を、作成フォームに最初から出すため */
  createFor: { object: string; defaults: Record<string, Scalar>; refs: Record<string, RefRecord> } | null
  toasts: Toast[]

  setTheme(theme: Theme): void
  toggleSidebar(): void
  setMobileNav(open: boolean): void
  setPalette(open: boolean): void
  setShortcuts(open: boolean): void
  openQuickAdd(seed?: QuickAddSeed): void
  closeQuickAdd(): void
  openCreate(object: string, defaults?: Record<string, Scalar>, refs?: Record<string, RefRecord>): void
  closeCreate(): void
  toast(toast: Omit<Toast, 'id'>): void
  dismissToast(id: number): void
}

const THEME_KEY = 'works.theme'
const SIDEBAR_KEY = 'works.sidebar'

function storedTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

/** <html data-theme> に反映する。index.html の先頭のスクリプトと同じ判定 */
export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

let toastSeq = 0

export const useUI = create<UIState>((set, get) => ({
  theme: storedTheme(),
  sidebarCollapsed: localStorage.getItem(SIDEBAR_KEY) === 'collapsed',
  mobileNavOpen: false,
  paletteOpen: false,
  shortcutsOpen: false,
  quickAdd: { open: false, seed: {} },
  createFor: null,
  toasts: [],

  setTheme(theme) {
    if (theme === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, theme)
    applyTheme(theme)
    set({ theme })
  },
  toggleSidebar() {
    const collapsed = !get().sidebarCollapsed
    localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'open')
    set({ sidebarCollapsed: collapsed })
  },
  setMobileNav: (open) => set({ mobileNavOpen: open }),
  setPalette: (open) => set({ paletteOpen: open }),
  setShortcuts: (open) => set({ shortcutsOpen: open }),
  openQuickAdd: (seed = {}) => set({ quickAdd: { open: true, seed }, paletteOpen: false }),
  closeQuickAdd: () => set({ quickAdd: { open: false, seed: {} } }),
  openCreate: (object, defaults = {}, refs = {}) => set({ createFor: { object, defaults, refs }, paletteOpen: false }),
  closeCreate: () => set({ createFor: null }),
  toast(toast) {
    const id = ++toastSeq
    set({ toasts: [...get().toasts.slice(-2), { ...toast, id }] })
    setTimeout(() => get().dismissToast(id), toast.action ? 7000 : 3500)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

/** モーダル類が開いている間は、一覧のキー操作(J/K など)を止める */
export function isOverlayOpen(): boolean {
  const s = useUI.getState()
  return s.paletteOpen || s.shortcutsOpen || s.quickAdd.open || s.createFor !== null
}
