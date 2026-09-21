import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cx } from '@/lib/cx'

/** ポップオーバーの描き先。モーダルの中では、そのモーダル(top layer)の中へ描かないと隠れてしまう */
const PortalContainer = createContext<HTMLElement | null>(null)

/** 開いているポップオーバーの数。Esc をモーダルとポップオーバーで取り合わないために数える */
let openPopovers = 0

// ---------------------------------------------------------------------------
// Modal — ブラウザ標準の <dialog>。フォーカスの閉じ込めと背後の無効化を標準に任せる
// ---------------------------------------------------------------------------

export function Modal({
  label,
  onClose,
  position = 'center',
  className,
  children,
}: {
  label: string
  onClose: () => void
  position?: 'center' | 'top'
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [container, setContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    setContainer(dialog)
    return () => dialog.close()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className="fixed inset-0 h-dvh w-screen overflow-hidden outline-none"
      onCancel={(e) => {
        e.preventDefault()
        if (openPopovers === 0) onClose()
      }}
    >
      <div className="absolute inset-0 animate-fade-in bg-ink/25 dark:bg-black/55" onClick={onClose} aria-hidden />
      <div
        className={cx(
          'pointer-events-none absolute inset-0 flex justify-center p-3 sm:p-6',
          position === 'top' ? 'items-start sm:pt-[12vh]' : 'items-center',
        )}
      >
        <div
          className={cx(
            'pointer-events-auto flex max-h-full w-full animate-pop-in flex-col overflow-hidden rounded-xl bg-raised shadow-pop',
            className,
          )}
        >
          <PortalContainer.Provider value={container}>{children}</PortalContainer.Provider>
        </div>
      </div>
    </dialog>
  )
}

// ---------------------------------------------------------------------------
// Popover — 基準の要素のそばに出す小さな面。外側のクリックと Esc で閉じる
// ---------------------------------------------------------------------------

export function Popover({
  anchor,
  onClose,
  align = 'start',
  width,
  className,
  children,
}: {
  anchor: HTMLElement | null
  onClose: () => void
  align?: 'start' | 'end'
  width?: number
  className?: string
  children: ReactNode
}) {
  const container = useContext(PortalContainer)
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useLayoutEffect(() => {
    if (!anchor) return
    const place = () => {
      const pop = ref.current
      if (!pop) return
      const a = anchor.getBoundingClientRect()
      const margin = 8
      const w = pop.offsetWidth
      const h = pop.offsetHeight
      let left = align === 'end' ? a.right - w : a.left
      left = Math.max(margin, Math.min(left, innerWidth - w - margin))
      const below = innerHeight - a.bottom - margin
      const above = a.top - margin
      // 下に収まらず、上のほうが広ければ上へ出す
      const openUp = h + 4 > below && above > below
      const top = openUp ? Math.max(margin, a.top - 4 - h) : a.bottom + 4
      setStyle({ top, left, maxHeight: (openUp ? above : below) - 4, visibility: 'visible' })
    }
    place()
    addEventListener('resize', place)
    addEventListener('scroll', place, true)
    return () => {
      removeEventListener('resize', place)
      removeEventListener('scroll', place, true)
    }
  }, [anchor, align])

  useEffect(() => {
    openPopovers++
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || anchor?.contains(target)) return
      onCloseRef.current()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      e.preventDefault()
      e.stopPropagation()
      onCloseRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      openPopovers--
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      // 閉じたら、開いた元へフォーカスを返す(キーボードで続けて操作できるように)。
      // ポップオーバーの中にあったフォーカスは、要素が消えた時点で body へ落ちている
      if (anchor?.isConnected && document.activeElement === document.body) anchor.focus({ preventScroll: true })
    }
  }, [anchor])

  if (!anchor) return null
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      style={{ ...style, width }}
      className={cx(
        'fixed z-50 flex animate-pop-in flex-col overflow-hidden rounded-lg bg-raised text-base shadow-pop',
        className,
      )}
    >
      {children}
    </div>,
    container ?? document.body,
  )
}
