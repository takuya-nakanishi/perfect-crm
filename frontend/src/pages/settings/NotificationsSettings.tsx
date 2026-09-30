import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ExternalLink, Hash, Plug, RefreshCw, Send, Unplug } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useOutletContext, useSearchParams } from 'react-router'
import { api, ApiError } from '@/api/client'
import type { MetaResponse, SlackConnection, SlackStatus } from '@/api/types'
import { Avatar, Button, Tag } from '@/components/ui/basics'
import { cx } from '@/lib/cx'
import { formatDateTime } from '@/lib/dates'
import { useUI } from '@/state/ui'
import { SectionHeader } from './SettingsPage'

const STEPS = [
  '「Slack と連携する」を押す',
  'Slack で、ワークスペースと通知先のチャンネルを選んで「許可する」(非公開のチャンネルも選べます)',
  '戻ってきたら「テスト通知を送る」で、そのチャンネルに届くことを確かめる',
]

/** Slack の許可の画面から戻ったときの知らせ(?slack=) */
const OUTCOMES: Record<string, { message: string; tone?: 'danger' }> = {
  connected: { message: 'Slack と連携しました。テスト通知で届くか確かめてください' },
  denied: { message: 'Slack での許可を取りやめました' },
  error: { message: 'Slack と連携できませんでした。もう一度お試しください', tone: 'danger' },
}

function Connected({ meta, connection }: { meta: MetaResponse; connection: SlackConnection }) {
  const qc = useQueryClient()
  const toast = useUI((s) => s.toast)
  const owner = meta.users.find((u) => u.id === connection.connected_by)
  const test = useMutation({
    mutationFn: () => api.slackTest(),
    onSuccess: (next) => {
      qc.setQueryData(['slack'], next)
      const error = next.connection?.last_error
      toast(error ? { message: error, tone: 'danger' } : { message: `テスト通知を送りました。Slack の ${connection.channel_name} を見てください` })
    },
    onError: (e) => toast({ message: e instanceof ApiError ? e.message : '送れませんでした', tone: 'danger' }),
  })
  const disconnect = useMutation({
    mutationFn: () => api.slackDisconnect(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['slack'] })
      toast({ message: 'Slack との連携を解除しました。通知は届かなくなります' })
    },
    onError: (e) => toast({ message: e instanceof ApiError ? e.message : '解除できませんでした', tone: 'danger' }),
  })
  const broken = connection.needs_reconnect

  return (
    <article className="rounded-lg shadow-[inset_0_0_0_1px_var(--line)]">
      <header className="flex items-center gap-3 px-4 py-3">
        <span className={cx('grid size-9 flex-none place-items-center rounded-full', broken ? 'bg-warn-wash text-warn' : 'bg-accent-wash text-accent-ink')}>
          <Hash size={17} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 font-bold">
            <span className="truncate">{connection.channel_name}</span>
            <Tag color={broken ? 'amber' : 'green'}>{broken ? '要再接続' : '連携中'}</Tag>
          </h3>
          <p className="truncate text-sm text-ink-3">
            {connection.team_name} · {connection.last_sent_at ? `最終送信 ${formatDateTime(connection.last_sent_at)}` : 'まだ送っていません'}
          </p>
        </div>
        {owner && (
          <span className="flex flex-none items-center gap-1.5 text-sm text-ink-3" title={`${owner.name} が ${formatDateTime(connection.connected_at)} に連携`}>
            <Avatar name={owner.name} color={owner.avatar_color} size={20} />
            <span className="hidden sm:inline">{formatDateTime(connection.connected_at)}</span>
          </span>
        )}
      </header>
      {connection.last_error && (
        <div role="alert" className={cx('mx-4 mb-3 flex gap-2 rounded-md px-3 py-2 text-sm', broken ? 'bg-warn-wash text-ink' : 'bg-danger-wash text-ink')}>
          <AlertTriangle size={15} className={cx('mt-0.5 flex-none', broken ? 'text-warn' : 'text-danger')} aria-hidden />
          <span className="min-w-0">
            {connection.last_error}
            {connection.last_error_at && <span className="block text-ink-3">{formatDateTime(connection.last_error_at)}</span>}
          </span>
        </div>
      )}
      <footer className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2.5">
        <Button variant={broken ? 'ghost' : 'outline'} onClick={() => test.mutate()} disabled={test.isPending}>
          <Send size={14} aria-hidden />
          テスト通知を送る
        </Button>
        <Button variant={broken ? 'primary' : 'ghost'} onClick={() => void connect()}>
          <RefreshCw size={14} aria-hidden />
          チャンネルを選び直す
        </Button>
        {connection.configuration_url && (
          <a href={connection.configuration_url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-base text-ink-2 hover:bg-sunken hover:text-ink">
            <ExternalLink size={14} aria-hidden />
            Slack で設定を開く
          </a>
        )}
        <span className="flex-1" />
        <Button variant="danger" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
          <Unplug size={14} aria-hidden />
          連携を解除
        </Button>
      </footer>
    </article>
  )
}

/** 許可の画面の URL はサーバが組み立てる(client_id も権限も画面は知らない)。画面はそこへ送り出すだけ */
async function connect() {
  try {
    const { url } = await api.slackConnect()
    location.assign(url)
  } catch (e) {
    useUI.getState().toast({ message: e instanceof ApiError ? e.message : 'Slack に繋げませんでした', tone: 'danger' })
  }
}

function SlackCard({ meta, status }: { meta: MetaResponse; status: SlackStatus }) {
  if (status.connection) return <Connected meta={meta} connection={status.connection} />
  if (!status.configured) {
    return (
      <div className="rounded-lg px-4 py-4 shadow-[inset_0_0_0_1px_var(--line)]">
        <p className="font-bold">Slack アプリの資格情報が入っていません</p>
        <p className="mt-1 text-sm text-ink-2">
          サーバの <code className="font-sans">.env</code> に <code className="font-sans">WORKS_SLACK_CLIENT_ID</code> と <code className="font-sans">WORKS_SLACK_CLIENT_SECRET</code> を入れて api を建て直すと、ここから連携できます(手順は docs/runbook/01 §6b)
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-lg px-4 py-4 shadow-[inset_0_0_0_1px_var(--line)]">
      <Button variant="primary" onClick={() => void connect()}>
        <Plug size={15} aria-hidden />
        Slack と連携する
      </Button>
      <ol className="mt-3 grid list-decimal gap-1.5 pl-5 text-ink-2">
        {STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  )
}

/** 届く本文の見本(架空の値)。実物はサーバが Block Kit で組み立てる(04 §14) */
function Preview() {
  return (
    <figure className="m-0 rounded-lg bg-chrome px-4 py-3" aria-label="届く通知の見本">
      <p className="font-bold">📨 Web フォームから登録がありました</p>
      <dl className="m-0 mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {[
          ['氏名', '山田 太郎'],
          ['メール', 'taro@example.jp'],
          ['電話', '03-0000-0000'],
          ['役割', '決裁者'],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="font-bold">{label}</dt>
            <dd className="m-0 text-ink-2">{value}</dd>
          </div>
        ))}
      </dl>
      <figcaption className="mt-2 text-sm text-ink-3">
        フォーム「Web サイトのお問い合わせ」から取引先責任者に登録 · <span className="text-accent-ink">Works で開く</span>
      </figcaption>
    </figure>
  )
}

/**
 * 通知。Web フォームから登録があったとき、Slack のチャンネルへ知らせる(ワークスペースで 1 つ)。
 * 繋ぎ方は Slack アプリの `incoming-webhook` だけで、チャンネルは Slack の許可の画面で選ぶ(04 §14)
 */
export function NotificationsSettings() {
  const meta = useOutletContext<MetaResponse>()
  const toast = useUI((s) => s.toast)
  const [params, setParams] = useSearchParams()
  const slack = useQuery({ queryKey: ['slack'], queryFn: () => api.slackStatus() })
  // Slack の許可の画面から戻ったとき(?slack=connected など)に 1 回だけ知らせる
  const outcome = params.get('slack')
  const told = useRef(false)
  useEffect(() => {
    if (!outcome || told.current) return
    told.current = true
    const known = OUTCOMES[outcome]
    if (known) toast(known)
    setParams((p) => {
      p.delete('slack')
      return p
    }, { replace: true })
  }, [outcome, setParams, toast])

  return (
    <>
      <SectionHeader title="通知" hint="Web フォームから登録があったとき、Slack のチャンネルへ知らせます。チャンネルは Slack の許可の画面で選びます" />
      <div className="grid gap-8 px-5 pb-10 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h3 className="mb-2 font-bold">Slack</h3>
          {slack.data && <SlackCard meta={meta} status={slack.data} />}
          <p className="mt-1.5 text-sm text-ink-3">繋げるチャンネルは 1 つです。変えるときは「チャンネルを選び直す」から、もう一度 Slack で選びます</p>
        </div>
        <div className="min-w-0">
          <h3 className="mb-2 font-bold">知らせること</h3>
          <ul className="mb-3 grid list-disc gap-1.5 pl-5 text-ink-2">
            <li>Web フォームから登録があったとき(Web フォームの「テスト送信」も含む)。載るのは、そのフォームが受け付けた項目と、Works で開くリンクです</li>
            <li>bot と判断した送信(見えない欄が埋まっていたもの)は知らせません</li>
            <li>送れなかったときは、ここに理由が出ます。フォームの受け付けは止まりません</li>
          </ul>
          <Preview />
        </div>
      </div>
    </>
  )
}
