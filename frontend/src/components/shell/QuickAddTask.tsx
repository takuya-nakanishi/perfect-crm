import { CalendarDays, CornerDownLeft, Flag, Repeat } from 'lucide-react'
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type InputHTMLAttributes } from 'react'
import type { FieldMeta, MetaResponse, References, Row, Scalar } from '@/api/types'
import { FieldEditor } from '@/components/record/FieldEditor'
import { Button, Kbd } from '@/components/ui/basics'
import { Modal } from '@/components/ui/overlay'
import { useCreateRecord } from '@/data/mutations'
import { formatDue } from '@/lib/dates'
import { parseQuickAdd, splitQuickAdd, type QuickAddToken } from '@/lib/quickAddParser'
import { optionOf } from '@/lib/records'
import { usePeek } from '@/lib/usePeek'
import { useUI, type QuickAddSeed } from '@/state/ui'

/**
 * タスクの追加欄(Q)。どの画面からでも開き、1 行書いて Enter で閉じる。
 * 件名に「明日」「金曜」「9/30」「p1」と書けば、期限と優先度として読み取り、その単語に色の地を敷く。
 */
export function QuickAddTask({ meta, seed }: { meta: MetaResponse; seed: QuickAddSeed }) {
  const close = useUI((s) => s.closeQuickAdd)
  const toast = useUI((s) => s.toast)
  const create = useCreateRecord()
  const { openPeek } = usePeek()

  const object = meta.objects.find((o) => o.completion)
  const [text, setText] = useState('')
  const [description, setDescription] = useState('')
  const [manual, setManual] = useState<Record<string, Scalar>>(() => {
    const init: Record<string, Scalar> = {}
    if (seed.related) Object.assign(init, { related_object: seed.related.object, related_id: seed.related.ref.id })
    if (seed.contact) init.contact_id = seed.contact.id
    return init
  })
  const [refs, setRefs] = useState<References>(() => {
    const init: References = {}
    if (seed.related) init[seed.related.object] = { [seed.related.ref.id]: seed.related.ref }
    if (seed.contact) init.contacts = { ...init.contacts, [seed.contact.id]: seed.contact }
    return init
  })

  const parsed = useMemo(() => parseQuickAdd(text), [text])
  if (!object) return null

  const fields = {
    due: object.fields.find((f) => f.semantic === 'deadline'),
    priority: object.fields.find((f) => f.key === 'priority'),
    repeat: object.completion?.repeat_field ? object.fields.find((f) => f.key === object.completion!.repeat_field) : undefined,
    related: object.fields.find((f) => f.type === 'polymorphic'),
    contact: object.fields.find((f) => f.type === 'relation'),
  }

  // 手で選んだ値が優先。無ければ、件名から読み取った値
  const draft: Row = {
    id: 'draft',
    ...(fields.due && parsed.due_date ? { [fields.due.key]: parsed.due_date } : {}),
    ...(fields.priority && parsed.priority ? { [fields.priority.key]: parsed.priority } : {}),
    ...(fields.repeat && parsed.repeat ? { [fields.repeat.key]: parsed.repeat } : {}),
    ...manual,
  }

  const commit = (patch: Record<string, Scalar>, extra?: References) => {
    setManual((prev) => ({ ...prev, ...patch }))
    if (extra) setRefs((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { ...prev[k], ...v }])) }))
  }

  const canSubmit = parsed.title.trim().length > 0
  const submit = () => {
    if (!canSubmit) return
    const values: Record<string, Scalar> = { ...draft, [object.name_field]: parsed.title.trim(), description: description.trim() || null }
    delete values.id
    // mutate に渡す onSuccess は、この画面を閉じた(unmount した)あとには呼ばれない。閉じたあとに知らせたいので Promise で受ける。
    // 失敗はフック側(useCreateRecord)が知らせる
    create
      .mutateAsync({ object: object.key, values })
      .then((res) => toast({ message: 'タスクを追加しました', action: { label: '開く', run: () => openPeek(object.key, res.record.id) } }))
      .catch(() => {})
    close()
  }

  const chip = (field: FieldMeta | undefined, width: string) =>
    field && (
      <div className={width}>
        <FieldEditor meta={meta} object={object} field={field} row={draft} references={refs} onCommit={commit} variant="form" />
      </div>
    )
  const dueFromText = fields.due && parsed.due_date && !(fields.due.key in manual) ? parsed.due_date : null
  const priorityFromText = fields.priority && parsed.priority && !(fields.priority.key in manual) ? parsed.priority : null
  const repeatFromText = fields.repeat && parsed.repeat && !(fields.repeat.key in manual) ? fields.repeat.options?.find((o) => o.value === parsed.repeat) : null

  // 読み取った単語の色の地。期限と繰り返しはアクセントの緑、優先度はその選択肢の色(P1 赤…。完了のチェックの輪と同じ)。
  // 手で選び直した単語は、件名から外れるだけで値にはならないので、地を敷かずに線で囲む
  const applied = { due: !!dueFromText, priority: !!priorityFromText, repeat: !!repeatFromText }
  const priorityColor = fields.priority ? optionOf(fields.priority, parsed.priority)?.color : undefined
  const toneOf = (kind: QuickAddToken['kind']): CSSProperties =>
    !applied[kind]
      ? { boxShadow: 'inset 0 0 0 1px var(--line-strong)' }
      : { background: kind === 'priority' && priorityColor ? `var(--tag-${priorityColor}-bg)` : 'var(--accent-wash)' }

  return (
    <Modal label="タスクを追加" onClose={close} position="top" className="max-w-[640px]">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
      >
        <div className="px-4 pt-4">
          <TitleInput
            autoFocus
            value={text}
            tokens={parsed.tokens}
            toneOf={toneOf}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.ctrlKey && !e.metaKey) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="やること(例: 見積を送る 明日 p1)"
            aria-label="件名"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="詳細"
            aria-label="詳細"
            className="h-7 w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
          />
          {(dueFromText || priorityFromText || repeatFromText) && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-accent-ink" aria-live="polite">
              {dueFromText && (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays size={13} aria-hidden />
                  期限を{formatDue(dueFromText)}にします
                </span>
              )}
              {priorityFromText && (
                <span className="inline-flex items-center gap-1">
                  <Flag size={13} aria-hidden />
                  優先度を {priorityFromText.toUpperCase()} にします
                </span>
              )}
              {repeatFromText && (
                <span className="inline-flex items-center gap-1">
                  <Repeat size={13} aria-hidden />
                  {repeatFromText.label}繰り返します(完了すると次回ができます)
                </span>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-4">
          {chip(fields.due, 'w-[152px] flex-none')}
          {chip(fields.repeat, 'w-[120px] flex-none')}
          {chip(fields.priority, 'w-[92px] flex-none')}
          {chip(fields.related, 'min-w-[180px] flex-1')}
          {chip(fields.contact, 'min-w-[150px] flex-1')}
        </div>

        <footer className="flex items-center gap-2 border-t border-line bg-chrome px-4 py-2.5">
          <p className="hidden flex-1 items-center gap-1.5 text-sm text-ink-2 sm:flex">
            <Kbd>
              <CornerDownLeft size={10} aria-label="Enter" />
            </Kbd>
            で追加
            <span className="mx-1 text-ink-3">/</span>
            <Kbd>Esc</Kbd>
            で閉じる
          </p>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={close}>
              キャンセル
            </Button>
            <Button variant="primary" type="submit" disabled={!canSubmit}>
              タスクを追加
            </Button>
          </div>
        </footer>
      </form>
    </Modal>
  )
}

/**
 * 色の地を、単語の文字から左右へはみ出させる幅(px)。同じだけ負の余白で打ち消すので、文字の位置は動かない。
 * 単語の間の空白は 3.8px しかない(16px の Figtree)。広げると「毎週 金曜」の地がつながって 1 つに見える
 */
const MARK_PAD = 1

/**
 * 件名の欄。読み取った単語の後ろに色の地を敷く(Todoist の追加欄と同じ見せ方)。
 * 文字は入力欄がそのまま描き、色の地だけを、同じ書体・大きさ・太さで組んだ後ろの層に並べる。
 * 文字まで上の層で描くと、日本語入力の変換中の下線や文節の区切りが見えなくなるため。
 */
function TitleInput({
  tokens,
  toneOf,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  value: string
  tokens: QuickAddToken[]
  toneOf: (kind: QuickAddToken['kind']) => CSSProperties
}) {
  const input = useRef<HTMLInputElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)

  // 長い件名で欄が横に流れたら、色の地も同じだけ流す。はみ出している側は、欄の縁で切る(地が縁の外に覗かない)
  const follow = () => {
    const el = input.current
    if (!el || !frame.current || !layer.current) return
    const left = el.scrollLeft
    const right = el.scrollWidth - el.clientWidth - left
    layer.current.style.transform = `translateX(${-left}px)`
    frame.current.style.clipPath = `inset(0 ${right > 0 ? MARK_PAD : 0}px 0 ${left > 0 ? MARK_PAD : 0}px)`
  }
  useLayoutEffect(follow)

  return (
    <div className="relative">
      <div
        ref={frame}
        aria-hidden
        className="pointer-events-none absolute inset-y-0 flex items-center overflow-hidden"
        style={{ left: -MARK_PAD, right: -MARK_PAD, paddingInline: MARK_PAD }}
      >
        <div ref={layer} className="text-lg font-bold whitespace-pre text-transparent">
          {splitQuickAdd(props.value, tokens).map((part, i) =>
            part.token ? (
              <mark
                key={part.token.kind}
                className="rounded-[4px] bg-transparent py-px text-transparent"
                style={{ marginInline: -MARK_PAD, paddingInline: MARK_PAD, ...toneOf(part.token.kind) }}
              >
                {part.text}
              </mark>
            ) : (
              <Fragment key={i}>{part.text}</Fragment>
            ),
          )}
        </div>
      </div>
      {/* スペルチェックの波線が「p1」の地の上に出ると、読み取った単語が誤りに見えるので切る */}
      <input
        ref={input}
        {...props}
        spellCheck={false}
        onScroll={follow}
        onSelect={follow}
        className="relative h-9 w-full bg-transparent text-lg font-bold text-ink outline-none placeholder:font-normal placeholder:text-ink-3"
      />
    </div>
  )
}
