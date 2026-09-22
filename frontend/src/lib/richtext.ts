/**
 * 書式付きの文字(richtext 型)の扱い。値は HTML で持つ。
 * 描くときは、ここで許した要素と属性だけを残す(サーバも同じ規則で保存前に洗う前提。04 §1)。
 */
const ALLOWED: Record<string, string[]> = {
  p: [],
  br: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  s: [],
  ul: [],
  ol: [],
  li: [],
  h1: [],
  h2: [],
  h3: [],
  blockquote: [],
  code: [],
  pre: [],
  a: ['href'],
}

/** @ で言及したレコード。エディタ(Tiptap の Mention)が書く形と同じ */
export interface Mention {
  object: string
  id: string
  label: string
}

const MENTION_ID = /^([a-z][a-z0-9_]*):([0-9a-f-]{36})$/

export function parseMentionId(raw: string | null | undefined): { object: string; id: string } | null {
  const m = raw ? MENTION_ID.exec(raw) : null
  return m ? { object: m[1], id: m[2] } : null
}

/** 内容(HTML)から言及を拾う。同じレコードは 1 回。サーバも同じ規則で mentions 列を作る */
export function extractMentions(html: string | null | undefined): Mention[] {
  if (!html) return []
  // 表示と同じく DOM で解釈する(正規表現だと引用符の違いで取りこぼす)
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out: Mention[] = []
  const seen = new Set<string>()
  for (const el of Array.from(doc.querySelectorAll('[data-type="mention"]'))) {
    const id = el.getAttribute('data-id')
    const ref = parseMentionId(id)
    if (!ref || seen.has(id!)) continue
    seen.add(id!)
    out.push({ ...ref, label: el.getAttribute('data-label') ?? el.textContent?.replace(/^@/, '') ?? '' })
  }
  return out
}

function clean(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '')
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  // 言及は <span data-type="mention" data-id="テーブル名:ID" data-label="名前">@名前</span> だけを通す
  if (tag === 'span' && el.getAttribute('data-type') === 'mention' && parseMentionId(el.getAttribute('data-id'))) {
    const out = doc.createElement('span')
    out.setAttribute('data-type', 'mention')
    out.setAttribute('data-id', el.getAttribute('data-id')!)
    out.setAttribute('data-label', el.getAttribute('data-label') ?? '')
    out.setAttribute('role', 'link')
    out.setAttribute('tabindex', '0')
    out.textContent = el.textContent ?? ''
    return out
  }
  const allowed = ALLOWED[tag]
  // 許さない要素は、中身だけを残す(<div> や <span> の入れ子を平らにする)
  const out = allowed ? doc.createElement(tag) : doc.createDocumentFragment()
  if (allowed && out instanceof Element) {
    for (const name of allowed) {
      const value = el.getAttribute(name)
      if (name === 'href' && value && /^(https?:|mailto:|tel:)/i.test(value.trim())) {
        out.setAttribute('href', value)
        out.setAttribute('target', '_blank')
        out.setAttribute('rel', 'noreferrer')
      }
    }
  }
  for (const child of Array.from(el.childNodes)) {
    const c = clean(child, doc)
    if (c) out.append(c)
  }
  return out
}

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const root = doc.createElement('div')
  for (const child of Array.from(doc.body.childNodes)) {
    const c = clean(child, doc)
    if (c) root.append(c)
  }
  return root.innerHTML
}

/** 書式を落とした素の文字(一覧の要約、検索、CSV に使う) */
export function plainText(html: string): string {
  return html
    .replace(/<\/(p|li|h[1-6]|blockquote|pre|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** 中身が空か(<p></p> だけの HTML も空とみなす) */
export function isEmptyHtml(html: string | null | undefined): boolean {
  return !html || plainText(html) === ''
}
