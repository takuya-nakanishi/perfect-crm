import { CalendarDays, CornerDownLeft, Flag } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FieldMeta, MetaResponse, References, Row, Scalar } from '@/api/types'
import { FieldEditor } from '@/components/record/FieldEditor'
import { Button, Kbd } from '@/components/ui/basics'
import { Modal } from '@/components/ui/overlay'
import { useCreateRecord } from '@/data/mutations'
import { formatDue } from '@/lib/dates'
import { parseQuickAdd } from '@/lib/quickAddParser'
import { usePeek } from '@/lib/usePeek'
import { useUI, type QuickAddSeed } from '@/state/ui'

/**
 * タスクの追加欄(Q)。どの画面からでも開き、1 行書いて Enter で閉じる。
 * 件名に「明日」「金曜」「9/30」「p1」と書けば、期限と優先度として読み取る。
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
    related: object.fields.find((f) => f.type === 'polymorphic'),
    contact: object.fields.find((f) => f.type === 'relation'),
  }

  // 手で選んだ値が優先。無ければ、件名から読み取った値
  const draft: Row = {
    id: 'draft',
    ...(fields.due && parsed.due_date ? { [fields.due.key]: parsed.due_date } : {}),
    ...(fields.priority && parsed.priority ? { [fields.priority.key]: parsed.priority } : {}),
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
    create.mutate(
      { object: object.key, values },
      {
        onSuccess: (res) =>
          toast({ message: 'タスクを追加しました', action: { label: '開く', run: () => openPeek(object.key, res.record.id) } }),
      },
    )
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
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.ctrlKey && !e.metaKey) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="やること(例: 見積を送る 明日 p1)"
            aria-label="件名"
            className="h-9 w-full bg-transparent text-lg font-bold text-ink outline-none placeholder:font-normal placeholder:text-ink-3"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="詳細"
            aria-label="詳細"
            className="h-7 w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
          />
          {(dueFromText || priorityFromText) && (
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
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-4">
          {chip(fields.due, 'w-[152px] flex-none')}
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
