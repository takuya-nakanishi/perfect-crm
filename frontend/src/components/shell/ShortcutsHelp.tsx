import { X } from 'lucide-react'
import { IconButton, Kbd } from '@/components/ui/basics'
import { Modal } from '@/components/ui/overlay'
import { SHORTCUTS } from '@/lib/hotkeys'
import { useUI } from '@/state/ui'

const JOIN_LABEL = { '+': '+', then: 'の次に', or: 'か' } as const

export function ShortcutsHelp() {
  const close = () => useUI.getState().setShortcuts(false)
  return (
    <Modal label="ショートカット" onClose={close} className="max-w-[720px]">
      <header className="flex flex-none items-center px-5 pt-4 pb-2">
        <h2 className="flex-1 text-lg font-bold">ショートカット</h2>
        <IconButton label="閉じる" onClick={close}>
          <X size={16} />
        </IconButton>
      </header>
      {/* 群の数が変わっても左右の高さが揃うよう、段組みで流す */}
      <div className="min-h-0 gap-x-10 overflow-y-auto px-5 pb-1 sm:columns-2">
        {SHORTCUTS.map((group) => (
          <section key={group.group} className="mb-5 break-inside-avoid">
            <h3 className="border-b border-line pb-1.5 text-sm text-ink-2">{group.group}</h3>
            <dl className="m-0">
              {group.items.map((item) => (
                <div key={item.label} className="flex min-h-9 items-center gap-3 border-b border-line py-1 last:border-0">
                  <dt className="flex-1">{item.label}</dt>
                  <dd className="m-0 flex flex-none items-center gap-1">
                    {item.keys.map((k, i) => (
                      <span key={k} className="inline-flex items-center gap-1">
                        {i > 0 && <span className="text-xs text-ink-3">{JOIN_LABEL[item.join ?? 'or']}</span>}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  )
}
