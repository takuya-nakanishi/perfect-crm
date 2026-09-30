import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ExternalLink, Hash, Plus, RefreshCw, Send, Unplug } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router'
import { api, ApiError } from '@/api/client'
import type { MetaResponse, SlackChannel, Workflow } from '@/api/types'
import { Avatar, Button, IconButton, Tag } from '@/components/ui/basics'
import { cx } from '@/lib/cx'
import { formatDateTime } from '@/lib/dates'
import { useUI } from '@/state/ui'
import { SectionHeader } from './SettingsPage'

const STEPS = [
  '「チャンネルを追加」を押す',
  'Slack で、ワークスペースと送り先のチャンネルを選んで「許可する」(非公開のチャンネルも選べます)',
  '戻ってきたら「テスト通知」で、そのチャンネルに届くことを確かめる',
  'ワークフローの「Slack に知らせる」で、そのチャンネルを選ぶ',
]

/** Slack の許可の画面から戻ったときの知らせ(?slack=) */
const OUTCOMES: Record<string, { message: string; tone?: 'danger' }> = {
  connected: { message: 'Slack のチャンネルを繋ぎました。テスト通知で届くか確かめてください' },
  denied: { message: 'Slack での許可を取りやめました' },
  error: { message: 'Slack と繋げませんでした。もう一度お試しください', tone: 'danger' },
}

/** 許可の画面の URL はサーバが組み立てる(client_id も権限も画面は知らない)。画面はそこへ送り出すだけ */
async function connect() {
  try {
    const { url } = await api.slackConnect('/settings/slack')
    location.assign(url)
  } catch (e) {
    useUI.getState().toast({ message: e instanceof ApiError ? e.message : 'Slack に繋げませんでした', tone: 'danger' })
  }
}

function ChannelRow({ meta, channel, usedBy }: { meta: MetaResponse; channel: SlackChannel; usedBy: Workflow[] }) {
  const qc = useQueryClient()
  const toast = useUI((s) => s.toast)
  const owner = meta.users.find((u) => u.id === channel.connected_by)
  const test = useMutation({
    mutationFn: () => api.slackTest(channel.id),
    onSuccess: (next) => {
      qc.setQueryData(['slack'], next)
      const error = next.channels.find((c) => c.id === channel.id)?.last_error
      toast(error ? { message: error, tone: 'danger' } : { message: `テスト通知を送りました。Slack の ${channel.channel_name} を見てください` })
    },
    onError: (e) => toast({ message: e instanceof ApiError ? e.message : '送れませんでした', tone: 'danger' }),
  })
  const disconnect = useMutation({
    mutationFn: () => api.slackDisconnect(channel.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['slack'] })
      // Slack のアプリは外さない(ほかの仕組みと共有している。04 §14)。Slack 側の Webhook は残るので、消す場所を添える
      const url = channel.configuration_url
      toast({
        message: `${channel.channel_name} を外しました。Works からはもう送りません。Slack 側に残った Webhook は、Slack のアプリの設定から消せます`,
        action: url ? { label: 'Slack で開く', run: () => void window.open(url, '_blank', 'noreferrer') } : undefined,
      })
    },
    onError: (e) => toast({ message: e instanceof ApiError ? e.message : '外せませんでした', tone: 'danger' }),
  })
  const broken = channel.needs_reconnect

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-b border-line px-2 py-3 md:grid-cols-[auto_minmax(0,1fr)_auto]">
      <span className={cx('mt-0.5 grid size-8 flex-none place-items-center rounded-full', broken ? 'bg-warn-wash text-warn' : 'bg-accent-wash text-accent-ink')}>
        <Hash size={16} aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-2">
          <span className="truncate font-bold">{channel.channel_name.replace(/^#/, '')}</span>
          {broken && <Tag color="amber">要再接続</Tag>}
        </p>
        <p className="truncate text-sm text-ink-3">
          {channel.team_name} · {channel.last_sent_at ? `最終送信 ${formatDateTime(channel.last_sent_at)}` : 'まだ送っていません'}
        </p>
        <p className="truncate text-sm text-ink-2">
          {usedBy.length ? `送っているワークフロー: ${usedBy.map((w) => w.name).join('、')}` : 'まだどのワークフローも送っていません'}
        </p>
        {channel.last_error && (
          <p role="alert" className={cx('mt-1.5 flex gap-2 rounded-md px-3 py-2 text-sm text-ink', broken ? 'bg-warn-wash' : 'bg-danger-wash')}>
            <AlertTriangle size={15} className={cx('mt-0.5 flex-none', broken ? 'text-warn' : 'text-danger')} aria-hidden />
            <span className="min-w-0">
              {channel.last_error}
              {channel.last_error_at && <span className="block text-ink-3">{formatDateTime(channel.last_error_at)}</span>}
            </span>
          </p>
        )}
      </div>
      <div className="col-span-2 mt-2 flex flex-wrap items-center gap-1 md:col-span-1 md:mt-0 md:justify-end">
        {owner && (
          <span className="mr-1 hidden items-center gap-1.5 text-sm text-ink-3 lg:inline-flex" title={`${owner.name} が ${formatDateTime(channel.connected_at)} に繋いだ`}>
            <Avatar name={owner.name} color={owner.avatar_color} size={18} />
          </span>
        )}
        {broken ? (
          <Button size="sm" variant="primary" onClick={() => void connect()} title="Slack の許可の画面で、同じチャンネルをもう一度選ぶ">
            <RefreshCw size={13} aria-hidden />
            繋ぎ直す
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
            <Send size={13} aria-hidden />
            テスト通知
          </Button>
        )}
        {channel.configuration_url && (
          <a href={channel.configuration_url} target="_blank" rel="noreferrer" aria-label="Slack で設定を開く" title="Slack で設定を開く" className="grid size-7 place-items-center rounded-md text-ink-2 hover:bg-sunken hover:text-ink">
            <ExternalLink size={14} aria-hidden />
          </a>
        )}
        <IconButton label={`${channel.channel_name} を外す`} className="hover:bg-danger-wash hover:text-danger" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
          <Unplug size={14} />
        </IconButton>
      </div>
    </div>
  )
}

/**
 * Slack のチャンネル(04 §14)。ワークフローの「Slack に知らせる」の送り先。いくつでも繋げる。
 * 繋ぎ方は Slack アプリの `incoming-webhook` だけで、チャンネルは Slack の許可の画面で選ぶ
 */
export function SlackSettings() {
  const meta = useOutletContext<MetaResponse>()
  const toast = useUI((s) => s.toast)
  const [params, setParams] = useSearchParams()
  const slack = useQuery({ queryKey: ['slack'], queryFn: () => api.slackStatus() })
  const workflows = useQuery({ queryKey: ['workflows'], queryFn: () => api.listWorkflows() })
  // Slack の許可の画面から戻ったとき(?slack=connected など)に 1 回だけ知らせる
  const outcome = params.get('slack')
  const told = useRef(false)
  useEffect(() => {
    if (!outcome || told.current) return
    told.current = true
    const known = OUTCOMES[outcome]
    if (known) toast(known)
    setParams(
      (p) => {
        p.delete('slack')
        p.delete('channel')
        return p
      },
      { replace: true },
    )
  }, [outcome, setParams, toast])

  const status = slack.data
  const usedBy = (id: string) => (workflows.data ?? []).filter((w) => w.actions.some((a) => a.channel === id))

  return (
    <>
      <SectionHeader title="Slack" hint="ワークフローの「Slack に知らせる」の送り先。チャンネルは Slack の許可の画面で選び、いくつでも繋げます">
        {status?.configured && (
          <Button variant="primary" onClick={() => void connect()}>
            <Plus size={15} strokeWidth={2.5} aria-hidden />
            チャンネルを追加
          </Button>
        )}
      </SectionHeader>
      <div className="px-5 pb-10 md:px-8">
        {status && !status.configured && (
          <div className="rounded-lg px-4 py-4 shadow-[inset_0_0_0_1px_var(--line)]">
            <p className="font-bold">Slack アプリの資格情報が入っていません</p>
            <p className="mt-1 text-sm text-ink-2">
              サーバの <code className="font-sans">.env</code> に <code className="font-sans">WORKS_SLACK_CLIENT_ID</code> と <code className="font-sans">WORKS_SLACK_CLIENT_SECRET</code> を入れて api を建て直すと、ここから繋げます(手順は docs/runbook/01 §6b)
            </p>
          </div>
        )}
        {status?.configured && status.channels.length === 0 && (
          <div className="rounded-lg px-5 py-6 shadow-[inset_0_0_0_1px_var(--line)]">
            <p className="font-bold">まだチャンネルを繋いでいません</p>
            <ol className="mt-3 grid list-decimal gap-1.5 pl-5 text-ink-2">
              {STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        )}
        {status && status.channels.length > 0 && (
          <div className="border-t border-line">
            {status.channels.map((c) => (
              <ChannelRow key={c.id} meta={meta} channel={c} usedBy={usedBy(c.id)} />
            ))}
          </div>
        )}
        <details className="mt-6 text-sm text-ink-2">
          <summary className="cursor-pointer text-ink">仕組み</summary>
          <ul className="mt-2 grid gap-1 pl-5">
            <li>
              何をいつ知らせるかは、<Link to="/settings/workflows" className="text-accent-ink underline-offset-4 hover:underline">ワークフロー</Link>で決めます。ここはその送り先です
            </li>
            <li>同じチャンネルをもう一度選ぶと、繋ぎ直しになります(チャンネルは増えず、ワークフローの設定もそのまま)。「要再接続」になったら、これで直ります</li>
            <li>ワークフローが送っているチャンネルは外せません。先にワークフローの送り先を替えてください</li>
            <li>外しても、Slack のアプリは外しません(ほかの通知と共有しているため)。Slack 側に残った Webhook は、Slack のアプリの設定から消せます</li>
          </ul>
        </details>
      </div>
    </>
  )
}
