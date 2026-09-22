import { Mention, type MentionNodeAttrs } from '@tiptap/extension-mention'
import { Placeholder } from '@tiptap/extensions'
import { EditorContent, ReactRenderer, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { MetaResponse, SearchHit } from '@/api/types'
import { keys } from '@/data/queries'
import { MentionList, type MentionListHandle } from './MentionList'
import { Bold, Italic, Link2, List, ListOrdered, Strikethrough, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Popover } from '@/components/ui/overlay'
import { cx } from '@/lib/cx'

/**
 * @ に続けて打つと、全テーブルのレコードを探して言及できる(GitHub のコメント欄と同じ)。
 * 候補は横断検索(GET /search)で、選ぶと <span data-type="mention" data-id="テーブル名:ID" data-label="名前"> が入る。
 * 一覧はモーダルの中でも隠れないよう、開いている <dialog> があればその中へ描く
 */
function mentionSuggestion(meta: MetaResponse): Omit<SuggestionOptions<SearchHit, MentionNodeAttrs>, 'editor'> {
  return {
    char: '@',
    allowSpaces: false,
    items: async ({ query }) => (query ? (await api.search(query)).hits.slice(0, 8) : []),
    render: () => {
      let component: ReactRenderer<MentionListHandle> | null = null
      let popup: HTMLDivElement | null = null
      const place = (rect: (() => DOMRect | null) | null | undefined) => {
        const r = rect?.()
        if (!popup || !r) return
        const w = 300
        const left = Math.max(8, Math.min(r.left, innerWidth - w - 8))
        const below = innerHeight - r.bottom > 260
        popup.style.left = `${left}px`
        popup.style.top = below ? `${r.bottom + 4}px` : ''
        popup.style.bottom = below ? '' : `${innerHeight - r.top + 4}px`
      }
      return {
        onStart(props) {
          component = new ReactRenderer(MentionList, { props: { ...props, meta }, editor: props.editor })
          popup = document.createElement('div')
          popup.className = 'fixed z-50 animate-pop-in overflow-hidden rounded-lg bg-raised text-base shadow-pop'
          popup.append(component.element)
          ;(document.querySelector('dialog[open]') ?? document.body).append(popup)
          place(props.clientRect)
        },
        onUpdate(props) {
          component?.updateProps({ ...props, meta })
          place(props.clientRect)
        },
        onKeyDown(props) {
          if (props.event.key === 'Escape') {
            popup?.remove()
            return true
          }
          return component?.ref?.onKeyDown(props.event) ?? false
        },
        onExit() {
          component?.destroy()
          popup?.remove()
          component = null
          popup = null
        },
      }
    },
  }
}

/**
 * 書式付きの文字の入力欄(Tiptap)。値は HTML。
 * - 太字・斜体・取り消し線・箇条書き・番号付き・リンクだけ。見出しや引用も Markdown 風の記法(## / >)で打てば入る
 * - Ctrl+Enter で onSubmit、Esc で onCancel。確定(onBlur)は、外へフォーカスが移ったとき
 */
export function RichTextEditor({
  value,
  onChange,
  onBlur,
  onSubmit,
  onCancel,
  placeholder,
  autoFocus,
  variant = 'form',
  minHeight = '5.5rem',
}: {
  value: string | null
  onChange: (html: string | null) => void
  onBlur?: () => void
  onSubmit?: () => void
  onCancel?: () => void
  placeholder?: string
  autoFocus?: boolean
  /** form = 枠のある欄 / inline = パネルの中(触るまで文字に見える) */
  variant?: 'form' | 'inline'
  minHeight?: string
}) {
  const handlers = useRef({ onChange, onBlur, onSubmit, onCancel })
  useEffect(() => {
    handlers.current = { onChange, onBlur, onSubmit, onCancel }
  })
  const qc = useQueryClient()
  const meta = qc.getQueryData<MetaResponse>(keys.meta)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' }, codeBlock: false }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      Mention.configure({
        HTMLAttributes: { class: 'mention' },
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
        suggestion: meta ? mentionSuggestion(meta) : undefined,
      }),
    ],
    content: value ?? '',
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: 'rich outline-none' },
      handleKeyDown(_view, e) {
        if (e.isComposing) return false
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          // 外側のフォームにも同じキーの処理があるので、二重に送らない
          e.stopPropagation()
          handlers.current.onSubmit?.()
          return true
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          handlers.current.onCancel?.()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor }) => handlers.current.onChange(editor.isEmpty ? null : editor.getHTML()),
  })

  return (
    <div
      className={cx(
        'group/rich rounded-md transition-shadow duration-100',
        variant === 'form'
          ? 'bg-paper shadow-[inset_0_0_0_1px_var(--line-strong)] focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]'
          : 'focus-within:bg-paper focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]',
      )}
      onBlur={(e) => {
        // 道具の列(太字など)へ移るときは、まだ書いている最中
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        handlers.current.onBlur?.()
      }}
    >
      <EditorContent editor={editor} className="px-2 py-1.5" style={{ minHeight }} />
      {editor && <Toolbar editor={editor} />}
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const [linkAnchor, setLinkAnchor] = useState<HTMLElement | null>(null)
  const [href, setHref] = useState('')
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      bullet: editor.isActive('bulletList'),
      ordered: editor.isActive('orderedList'),
      link: editor.isActive('link'),
    }),
  })
  const tool = (label: string, Icon: LucideIcon, active: boolean, run: () => void, kbd?: string) => (
    <button
      key={label}
      type="button"
      tabIndex={-1}
      aria-label={label}
      aria-pressed={active}
      title={kbd ? `${label} (${kbd})` : label}
      // 押してもエディタからフォーカスを奪わない
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cx('grid size-7 place-items-center rounded-md', active ? 'bg-accent-wash text-accent-ink' : 'text-ink-3 hover:bg-sunken hover:text-ink')}
    >
      <Icon size={14} aria-hidden />
    </button>
  )
  return (
    <div role="toolbar" aria-label="書式" className="flex items-center gap-0.5 px-1 pb-1 opacity-60 group-focus-within/rich:opacity-100">
      {tool('太字', Bold, state.bold, () => editor.chain().focus().toggleBold().run(), 'Ctrl+B')}
      {tool('斜体', Italic, state.italic, () => editor.chain().focus().toggleItalic().run(), 'Ctrl+I')}
      {tool('取り消し線', Strikethrough, state.strike, () => editor.chain().focus().toggleStrike().run(), 'Ctrl+Shift+S')}
      <span className="mx-1 h-4 w-px bg-line" aria-hidden />
      {tool('箇条書き', List, state.bullet, () => editor.chain().focus().toggleBulletList().run(), '- と空白')}
      {tool('番号付き', ListOrdered, state.ordered, () => editor.chain().focus().toggleOrderedList().run(), '1. と空白')}
      <span className="mx-1 h-4 w-px bg-line" aria-hidden />
      <button
        type="button"
        tabIndex={-1}
        aria-label="リンク"
        aria-pressed={state.link}
        title="リンク"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          if (state.link) {
            editor.chain().focus().unsetLink().run()
            return
          }
          setHref(editor.getAttributes('link').href ?? '')
          setLinkAnchor(e.currentTarget)
        }}
        className={cx('grid size-7 place-items-center rounded-md', state.link ? 'bg-accent-wash text-accent-ink' : 'text-ink-3 hover:bg-sunken hover:text-ink')}
      >
        <Link2 size={14} aria-hidden />
      </button>
      {linkAnchor && (
        <Popover anchor={linkAnchor} onClose={() => setLinkAnchor(null)} width={300}>
          <form
            className="flex items-center gap-1 p-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              const url = href.trim()
              if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: /^[a-z]+:/i.test(url) ? url : `https://${url}` }).run()
              setLinkAnchor(null)
            }}
          >
            <input
              autoFocus
              value={href}
              onChange={(e) => setHref(e.target.value)}
              placeholder="https://"
              aria-label="リンク先の URL"
              className="h-8 min-w-0 flex-1 rounded-md bg-paper px-2 text-base outline-none shadow-[inset_0_0_0_1px_var(--line-strong)] focus:shadow-[inset_0_0_0_1.5px_var(--accent)]"
            />
            <button type="submit" className="h-8 rounded-md bg-accent px-2.5 text-sm font-bold text-on-accent hover:bg-accent-strong">
              付ける
            </button>
          </form>
        </Popover>
      )}
    </div>
  )
}
