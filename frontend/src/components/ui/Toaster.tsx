import { X } from 'lucide-react'
import { cx } from '@/lib/cx'
import { useUI } from '@/state/ui'

/** 画面左下の通知。取り消しのある操作(完了・削除)では「元に戻す」を出す */
export function Toaster() {
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pointer-events-auto flex animate-toast-in items-center gap-2 rounded-lg py-2 pr-1.5 pl-3.5 text-base shadow-pop',
            t.tone === 'danger' ? 'bg-[#a82d28] text-white' : 'bg-[#1d2620] text-[#f0f4f1] dark:bg-[#2b332d]',
          )}
        >
          <span className="min-w-0 flex-1 truncate">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="flex-none rounded-md px-2 py-1 font-bold text-[#86dcad] hover:bg-white/10"
              onClick={() => {
                t.action?.run()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="閉じる"
            className="grid size-7 flex-none place-items-center rounded-md opacity-60 hover:bg-white/10 hover:opacity-100"
            onClick={() => dismiss(t.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
