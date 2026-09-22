import { lazy, Suspense, type KeyboardEvent, type MouseEvent } from 'react'
import { cx } from '@/lib/cx'
import { isEmptyHtml, parseMentionId, sanitizeHtml } from '@/lib/richtext'
import { usePeek } from '@/lib/usePeek'

/** 書式付きの文字を描く。許した要素だけを残してから差し込む(lib/richtext.ts)。@ の言及を押すと、そのレコードを開く */
export function RichTextView({ html, className }: { html: string | null | undefined; className?: string }) {
  const { openPeek } = usePeek()
  if (isEmptyHtml(html)) return null
  const open = (e: MouseEvent | KeyboardEvent) => {
    const el = (e.target as HTMLElement).closest('[data-type="mention"]')
    const ref = parseMentionId(el?.getAttribute('data-id'))
    if (!ref) return
    e.preventDefault()
    e.stopPropagation()
    openPeek(ref.object, ref.id)
  }
  return (
    <div
      className={cx('rich', className)}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) open(e)
      }}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html!) }}
    />
  )
}

// エディタ(Tiptap)は重いので、最初の表示には含めず、書き始めるときに読む
const RichTextEditor = lazy(() => import('./RichTextEditor').then((m) => ({ default: m.RichTextEditor })))

/** 読み込み中は、同じ高さの枠だけを出す(段が跳ねない) */
export function RichTextEditorLazy(props: Parameters<typeof RichTextEditor>[0]) {
  return (
    <Suspense fallback={<div className="min-h-[5.5rem] rounded-md bg-sunken" aria-busy />}>
      <RichTextEditor {...props} />
    </Suspense>
  )
}
