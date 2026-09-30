import { AlertTriangle, Check, ChevronDown, Hash, Plus } from 'lucide-react'
import { useState } from 'react'
import type { FieldMeta, MetaResponse, ObjectMeta, References, Row, SlackAction, SlackChannel } from '@/api/types'
import { Tag } from '@/components/ui/basics'
import { ChoiceList } from '@/components/ui/ChoiceList'
import { Popover } from '@/components/ui/overlay'
import { cx } from '@/lib/cx'
import { formatDateTime } from '@/lib/dates'
import { parseDriveFiles } from '@/lib/drive'
import { formatNumber, formatPercent, formatYen } from '@/lib/format'
import { fieldType } from '@/lib/icons'
import { optionOf, recordName, refFor } from '@/lib/records'
import { plainText } from '@/lib/richtext'

/** 載せられる項目(システムが埋める列と、見出しに出る表示名は除く) */
const slackFieldCandidates = (object: ObjectMeta) => object.fields.filter((f) => !f.readonly && f.key !== object.name_field)

/** Slack に届く形の値(素の文字)。本物はサーバが同じ規則で作る(`app/slack/message.py`) */
function plainValue(meta: MetaResponse, field: FieldMeta, row: Row, references: References): string {
  if (field.type === 'relation' || field.type === 'polymorphic') return refFor(field, row, references)?.ref.name ?? ''
  if (field.type === 'user') return meta.users.find((u) => u.id === row[field.key])?.name ?? ''
  const value = row[field.key]
  if (value === null || value === undefined || value === '') return ''
  switch (field.type) {
    case 'select':
      return optionOf(field, value)?.label ?? String(value)
    case 'multi_select': {
      try {
        const values = JSON.parse(String(value)) as unknown[]
        return values.map((v) => field.options?.find((o) => o.value === v)?.label ?? String(v)).join('、')
      } catch {
        return ''
      }
    }
    case 'currency':
      return formatYen(Number(value))
    case 'number':
      return formatNumber(Number(value), field.scale)
    case 'percent':
      return formatPercent(Number(value), field.scale)
    case 'datetime':
      return formatDateTime(String(value))
    case 'checkbox':
      return value ? 'はい' : ''
    case 'richtext':
      return plainText(String(value))
    case 'drive_files':
      return parseDriveFiles(value)
        .map((f) => f.name)
        .join('\n')
    default:
      return String(value)
  }
}

function ChannelPicker({
  channels,
  configured,
  value,
  invalid,
  onPick,
  onAdd,
}: {
  channels: SlackChannel[]
  configured: boolean
  value: string | null
  invalid: boolean
  onPick: (id: string) => void
  onAdd: () => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const current = channels.find((c) => c.id === value)
  return (
    <>
      <button
        type="button"
        aria-label="送り先のチャンネル"
        aria-haspopup="listbox"
        aria-invalid={invalid}
        onClick={(e) => setAnchor(e.currentTarget)}
        className={cx(
          'flex h-9 w-full max-w-sm items-center gap-2 rounded-md bg-paper px-2.5 text-left shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-sunken',
          invalid && 'shadow-[inset_0_0_0_1.5px_var(--danger)]',
        )}
      >
        <Hash size={15} className="flex-none text-ink-3" aria-hidden />
        {current ? (
          <>
            <span className="min-w-0 truncate font-bold">{current.channel_name.replace(/^#/, '')}</span>
            <span className="min-w-0 truncate text-sm text-ink-3">{current.team_name}</span>
            {current.needs_reconnect && <Tag color="amber">要再接続</Tag>}
          </>
        ) : (
          <span className="text-ink-3">{value ? '外されたチャンネル' : 'チャンネルを選ぶ'}</span>
        )}
        <ChevronDown size={14} className="ml-auto flex-none text-ink-3" aria-hidden />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={Math.max(280, anchor.offsetWidth)}>
          <ChoiceList
            choices={[
              ...channels.map((c) => ({
                id: c.id,
                node: (
                  <>
                    <Hash size={14} className="flex-none text-ink-3" aria-hidden />
                    <span className="truncate">{c.channel_name.replace(/^#/, '')}</span>
                    <span className="min-w-0 truncate text-sm text-ink-3">{c.team_name}</span>
                    {c.needs_reconnect && <Tag color="amber">要再接続</Tag>}
                  </>
                ),
                searchText: c.channel_name,
                selected: c.id === value,
                commit: () => {
                  onPick(c.id)
                  setAnchor(null)
                },
              })),
              {
                id: '__add',
                node: (
                  <span className={cx('flex items-center gap-2', configured ? 'text-accent-ink' : 'text-ink-3')}>
                    <Plus size={14} aria-hidden />
                    {configured ? 'Slack でチャンネルを追加…' : 'Slack アプリの資格情報が入っていません'}
                  </span>
                ),
                searchText: 'チャンネルを追加',
                selected: false,
                commit: () => {
                  if (!configured) return
                  setAnchor(null)
                  onAdd()
                },
              },
            ]}
          />
        </Popover>
      )}
    </>
  )
}

/** Slack に届く本文の見本。値は、このテーブルの最新のレコード(無ければ項目名) */
function MessagePreview({
  meta,
  object,
  title,
  fields,
  sample,
  event,
  origin,
}: {
  meta: MetaResponse
  object: ObjectMeta
  title: string
  fields: string[]
  sample: { record: Row; references: References } | null
  event: 'created' | 'matched'
  /** 見本に出す「どこから」 */
  origin: string
}) {
  const shown = fields
    .map((k) => object.fields.find((f) => f.key === k))
    .filter((f): f is FieldMeta => Boolean(f) && f!.key !== object.name_field)
    .map((f) => ({ field: f, value: sample ? plainValue(meta, f, sample.record, sample.references) : `(${f.label})` }))
    .filter((x) => x.value)
  const long = (f: FieldMeta) => f.type === 'textarea' || f.type === 'richtext'
  return (
    <figure aria-label="届く本文の見本" className="m-0 border-l-[3px] border-line-strong py-0.5 pl-3">
      <p className="font-bold">{title.trim() || 'ワークフローの名前'}</p>
      <p className="mt-1 font-bold">{sample ? recordName(object, sample.record) || '(名前なし)' : `(${object.fields.find((f) => f.key === object.name_field)?.label ?? '名前'})`}</p>
      {shown.length > 0 && (
        <dl className="m-0 mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          {shown.map(({ field, value }) => (
            <div key={field.key} className={cx('min-w-0', long(field) && 'col-span-2')}>
              <dt className="font-bold">{field.label}</dt>
              <dd className={cx('m-0 text-ink-2', long(field) ? 'line-clamp-3 whitespace-pre-line' : 'truncate')}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <figcaption className="mt-1.5 text-sm text-ink-3">
        {event === 'created' ? `${object.label}に作成` : `${object.label}が条件を満たしました`} · {origin} · <span className="text-accent-ink">Works で開く</span>
      </figcaption>
    </figure>
  )
}

/** アクション「Slack に知らせる」の中身。チャンネル・載せる項目・届く本文の見本 */
export function SlackActionBody({
  meta,
  object,
  action,
  channels,
  configured,
  title,
  event,
  origin,
  sample,
  issue,
  onChange,
  onAddChannel,
}: {
  meta: MetaResponse
  object: ObjectMeta
  action: SlackAction
  channels: SlackChannel[]
  configured: boolean
  title: string
  event: 'created' | 'matched'
  origin: string
  sample: { record: Row; references: References } | null
  issue?: string
  onChange: (action: SlackAction) => void
  onAddChannel: () => void
}) {
  const current = channels.find((c) => c.id === action.channel)
  const toggle = (key: string) => onChange({ ...action, fields: action.fields.includes(key) ? action.fields.filter((k) => k !== key) : [...action.fields, key] })
  const labelCls = 'pt-2 text-sm text-ink-2'
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
      <span className={labelCls}>チャンネル</span>
      <div className="min-w-0">
        <ChannelPicker channels={channels} configured={configured} value={action.channel} invalid={Boolean(issue)} onPick={(channel) => onChange({ ...action, channel })} onAdd={onAddChannel} />
        {issue && <p className="mt-1 text-sm text-danger">{issue}</p>}
        {current?.needs_reconnect && (
          <p className="mt-1 flex items-start gap-1.5 text-sm text-warn">
            <AlertTriangle size={14} className="mt-0.5 flex-none" aria-hidden />
            このチャンネルは要再接続です。環境設定の Slack から繋ぎ直すまで届きません
          </p>
        )}
        {channels.length === 0 && configured && <p className="mt-1 text-sm text-ink-3">まだ Slack のチャンネルがありません。「Slack でチャンネルを追加…」から、送り先を選んでください</p>}
      </div>

      <span className={labelCls}>載せる項目</span>
      <div className="min-w-0">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="載せる項目">
          {slackFieldCandidates(object).map((f) => {
            const on = action.fields.includes(f.key)
            const t = fieldType(f.type)
            return (
              <button
                key={f.key}
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => toggle(f.key)}
                className={cx('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-base', on ? 'bg-accent-wash font-bold text-accent-ink' : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-sunken')}
              >
                {on ? <Check size={13} aria-hidden /> : <t.icon size={13} className="text-ink-3" aria-hidden />}
                {f.label}
                {on && <span className="text-xs opacity-70 tabular-nums">{action.fields.indexOf(f.key) + 1}</span>}
              </button>
            )
          })}
        </div>
        <p className="mt-1 text-sm text-ink-3">押した順に並びます。レコードの名前は見出しの下に必ず出ます。空の項目は載せません</p>
      </div>

      <span className={labelCls}>届く本文</span>
      <div className="min-w-0 pt-1.5">
        <MessagePreview meta={meta} object={object} title={title} fields={action.fields} sample={sample} event={event} origin={origin} />
        <p className="mt-1.5 text-sm text-ink-3">{sample ? `${recordName(object, sample.record) || '最新のレコード'} の値で見せています` : 'まだレコードが無いので、項目名で見せています'}</p>
      </div>
    </div>
  )
}
