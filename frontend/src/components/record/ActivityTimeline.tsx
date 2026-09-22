import { Activity, AtSign, CircleCheck, Mail, MapPin, Phone, StickyNote, Users, Video, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import type { MetaResponse, ObjectMeta, RefRecord, Row, Scalar, TagColor, TimelineEntry } from '@/api/types'
import { Avatar, Button, Kbd, ObjectIcon, Tag } from '@/components/ui/basics'
import { useCreateRecord } from '@/data/mutations'
import { useTimeline } from '@/data/queries'
import { cx } from '@/lib/cx'
import { diffDays, parseISODate, todayISO, weekdayOf } from '@/lib/dates'
import { isEmptyHtml } from '@/lib/richtext'
import { usePeek } from '@/lib/usePeek'
import { useUI } from '@/state/ui'
import { FieldEditor } from './FieldEditor'
import { RichTextEditorLazy, RichTextView } from './RichText'

/** 種別の値 → 印。種別は設定で増やせるので、無いものは色の点で出す */
const TYPE_ICONS: Record<string, LucideIcon> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  visit: MapPin,
  web_meeting: Video,
  note: StickyNote,
  other: Activity,
}

/** 今日・昨日は言葉で、それ以外は「9月19日(土)」。未来の日付(予定を先に書いたとき)も同じ書式 */
function dayHeading(iso: string): string {
  const d = diffDays(iso, todayISO())
  if (d === 0) return '今日'
  if (d === -1) return '昨日'
  const date = parseISODate(iso)
  const sameYear = date.getFullYear() === parseISODate(todayISO()).getFullYear()
  return `${sameYear ? '' : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日(${weekdayOf(iso)})`
}

// ---------------------------------------------------------------------------
// 記録欄 — 1 行の欄に見え、押すと件名・種別・日付・内容に広がる
// ---------------------------------------------------------------------------

const preload = () => void import('./RichTextEditor')

function Composer({
  meta,
  activities,
  parent,
  parentRef,
}: {
  meta: MetaResponse
  activities: ObjectMeta
  parent: ObjectMeta
  parentRef: RefRecord
}) {
  const t = activities.timeline!
  const create = useCreateRecord()
  const toast = useUI((s) => s.toast)
  const [open, setOpen] = useState(false)
  const typeField = activities.fields.find((f) => f.key === t.type)
  const dateField = activities.fields.find((f) => f.key === t.date)
  const subjectField = activities.fields.find((f) => f.key === t.subject)
  const related = activities.fields.find((f) => f.type === 'polymorphic')
  // テーブル設定で足した項目(件名・種別・日付・内容・関連先・記録者以外)。必須のものは無いと記録できないので、ここにも描く
  const extraFields = activities.fields.filter(
    (f) => !f.readonly && f.type !== 'polymorphic' && f.type !== 'user' && ![t.subject, t.type, t.date, t.body].includes(f.key),
  )

  const blank = (): Row => ({
    id: 'draft',
    [t.subject]: '',
    [t.type]: typeField?.options?.[0]?.value ?? null,
    [t.date]: todayISO(),
    [t.body]: null,
  })
  const [draft, setDraft] = useState<Row>(blank)
  const [showErrors, setShowErrors] = useState(false)
  const patch = (p: Record<string, Scalar>) => setDraft((d) => ({ ...d, ...p }))
  const subject = String(draft[t.subject] ?? '').trim()

  const close = () => {
    setOpen(false)
    setDraft(blank())
    setShowErrors(false)
  }
  const submit = () => {
    if (!subject) {
      setShowErrors(true)
      return
    }
    const values: Record<string, Scalar> = { ...draft, [t.subject]: subject }
    delete values.id
    if (related?.columns) {
      values[related.columns.object] = parent.key
      values[related.columns.id] = parentRef.id
    }
    const snapshot = draft
    create
      .mutateAsync({ object: activities.key, values })
      .then(() => toast({ message: '活動を記録しました' }))
      .catch(() => {
        // 検証で弾かれたら、書いたものを消さずに欄を開き直す
        setDraft(snapshot)
        setOpen(true)
      })
    close()
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        // エディタは別ファイル。触れた時点で読み始め、押したときには手元にある
        onPointerEnter={preload}
        onFocus={preload}
        className="mt-2 flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-ink-3 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-chrome hover:text-ink-2"
      >
        {parentRef.name}についての活動を記録する…
      </button>
    )
  }

  return (
    <form
      className="mt-2 rounded-lg bg-chrome p-3 shadow-[inset_0_0_0_1px_var(--line)]"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          ;(document.activeElement as HTMLElement | null)?.blur()
          setTimeout(submit, 0)
        } else if (e.key === 'Escape') {
          e.stopPropagation()
          close()
        }
      }}
    >
      <input
        autoFocus
        value={String(draft[t.subject] ?? '')}
        aria-label={subjectField?.label ?? '件名'}
        aria-invalid={showErrors && !subject}
        placeholder={subjectField?.placeholder ?? '件名'}
        maxLength={subjectField?.max_length}
        onChange={(e) => patch({ [t.subject]: e.target.value })}
        className="h-9 w-full rounded-md bg-paper px-2 text-base font-bold outline-none placeholder:font-normal placeholder:text-ink-3 shadow-[inset_0_0_0_1px_var(--line-strong)] focus:shadow-[inset_0_0_0_1.5px_var(--accent)]"
      />
      {showErrors && !subject && <p className="mt-1 text-sm text-danger">件名を入力してください</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {typeField && (
          <div className="w-36">
            <FieldEditor meta={meta} object={activities} field={typeField} row={draft} references={{}} onCommit={patch} variant="form" />
          </div>
        )}
        {dateField && (
          <div className="w-40">
            <FieldEditor meta={meta} object={activities} field={dateField} row={draft} references={{}} onCommit={patch} variant="form" />
          </div>
        )}
      </div>
      {extraFields.length > 0 && (
        <dl className="m-0 mt-2 grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1">
          {extraFields.map((f) => (
            <div key={f.key} className="contents">
              <dt className="flex h-8 items-center truncate text-sm text-ink-2">
                {f.label}
                {f.required && <span className="ml-1 text-danger">*</span>}
              </dt>
              <dd className="m-0 min-w-0">
                <FieldEditor meta={meta} object={activities} field={f} row={draft} references={{}} onCommit={patch} variant="form" />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-2">
        <RichTextEditorLazy
          value={typeof draft[t.body] === 'string' ? String(draft[t.body]) : null}
          placeholder={`${activities.fields.find((f) => f.key === t.body)?.placeholder ?? '内容'}。@ で他のレコードに言及`}
          onChange={(html) => patch({ [t.body]: html })}
          onSubmit={submit}
          onCancel={close}
        />
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={close}>
          キャンセル
        </Button>
        <Button variant="primary" size="sm" type="submit" onMouseDown={() => (document.activeElement as HTMLElement | null)?.blur()}>
          記録する
          <span className="hidden opacity-80 sm:inline-flex sm:gap-0.5">
            <Kbd>Ctrl</Kbd>
            <Kbd>Enter</Kbd>
          </span>
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// 時系列 — サーバが合成した entries(活動 + 言及 + 完了したタスク)を描く
// ---------------------------------------------------------------------------

function Entry({ meta, entry }: { meta: MetaResponse; entry: TimelineEntry }) {
  const { openPeek } = usePeek()
  const source = meta.objects.find((o) => o.key === entry.object)
  const owner = meta.users.find((u) => u.id === entry.user_id)
  // 印: 完了したタスクはチェック、活動は種別の印
  let Icon: LucideIcon | undefined = entry.kind === 'completion' ? CircleCheck : entry.type ? TYPE_ICONS[entry.type.value] : undefined
  let color: TagColor = entry.kind === 'completion' ? 'green' : (entry.type?.color ?? 'gray')
  if (entry.kind === 'mention') {
    Icon = AtSign
    color = 'gray'
  }
  const relatedMeta = entry.related ? meta.objects.find((o) => o.key === entry.related!.object) : undefined

  return (
    <li className="relative pl-9">
      <span
        className="absolute top-0.5 left-0 grid size-6 place-items-center rounded-full"
        style={{ background: `var(--tag-${color}-bg)`, color: `var(--tag-${color}-ink)` }}
        aria-hidden
      >
        {Icon ? <Icon size={13} strokeWidth={2.25} /> : <span className="size-2 rounded-full bg-current" />}
      </span>
      <div className="flex min-w-0 items-baseline gap-2">
        <button
          type="button"
          onClick={() => openPeek(entry.object, entry.id)}
          title={source ? `${source.label}を開く` : undefined}
          className="-mx-1 min-w-0 truncate rounded px-1 text-left font-bold decoration-line-strong underline-offset-4 hover:bg-sunken hover:underline"
        >
          {entry.subject || '名称未設定'}
        </button>
        {entry.kind === 'completion' ? (
          <Tag color="green">完了</Tag>
        ) : (
          <>
            {entry.type && <Tag color={entry.type.color}>{entry.type.label}</Tag>}
            {entry.kind === 'mention' && <Tag color="gray">言及</Tag>}
          </>
        )}
        {owner && (
          <span className="ml-auto inline-flex flex-none items-center gap-1 text-sm text-ink-3">
            <Avatar name={owner.name} color={owner.avatar_color} size={16} />
            {owner.name}
          </span>
        )}
      </div>
      {entry.kind === 'mention' && relatedMeta && entry.related && (
        <button
          type="button"
          onClick={() => openPeek(relatedMeta.key, entry.related!.id)}
          className="-mx-1 mt-0.5 inline-flex max-w-full items-center gap-1.5 rounded px-1 text-sm text-ink-2 hover:bg-sunken hover:text-ink"
        >
          <ObjectIcon icon={relatedMeta.icon} color={relatedMeta.color} size={11} />
          <span className="truncate">{entry.related.name}</span>
          <span className="flex-none text-ink-3">の活動で言及</span>
        </button>
      )}
      {!isEmptyHtml(entry.body) && <RichTextView html={entry.body} className="mt-1 text-ink-2" />}
    </li>
  )
}

/** レコードのパネルの「活動」。新しいものが上。日付ごとに見出しを挟む */
export function ActivityTimeline({
  meta,
  activities,
  parent,
  parentRef,
}: {
  meta: MetaResponse
  activities: ObjectMeta
  parent: ObjectMeta
  parentRef: RefRecord
}) {
  const { data } = useTimeline(parent.key, parentRef.id)
  const entries = data?.entries ?? []

  // 日付ごとにまとめる(並びはサーバの結果のまま)
  const groups: { date: string; entries: TimelineEntry[] }[] = []
  for (const e of entries) {
    const last = groups[groups.length - 1]
    if (last && last.date === e.date) last.entries.push(e)
    else groups.push({ date: e.date, entries: [e] })
  }

  return (
    <section className="border-t border-line px-5 py-4" aria-label="活動">
      <header className="flex items-center gap-2">
        <ObjectIcon icon={activities.icon} color={activities.color} size={14} />
        <h3 className="font-bold">{activities.label}</h3>
        <span className="text-sm text-ink-3 tabular-nums">{data ? entries.length : ''}</span>
      </header>

      <Composer key={parentRef.id} meta={meta} activities={activities} parent={parent} parentRef={parentRef} />

      {entries.length > 0 ? (
        <div className="relative mt-4">
          {/* 縦の線。印の中心(左端から 12px)を通す */}
          <span className="absolute top-2 bottom-2 left-[11px] w-px bg-line" aria-hidden />
          {groups.map((g) => (
            <div key={g.date} className={cx('relative', g !== groups[0] && 'mt-4')}>
              <p className="relative mb-2 inline-block bg-paper pr-2 pl-9 text-sm text-ink-3">{g.date ? dayHeading(g.date) : '日付なし'}</p>
              <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
                {g.entries.map((e) => (
                  <Entry key={`${e.object}:${e.id}`} meta={meta} entry={e} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        data && <p className="mt-3 text-sm text-ink-3">まだ記録がありません。電話・打ち合わせ・メモを残すと、完了したタスクと一緒にここへ時系列で並びます。</p>
      )}
    </section>
  )
}
