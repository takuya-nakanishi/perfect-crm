import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useOutletContext } from 'react-router'
import { api, ApiError } from '@/api/client'
import type { McpToken, MetaResponse } from '@/api/types'
import { Avatar, Button, IconButton, Tag } from '@/components/ui/basics'
import { Modal } from '@/components/ui/overlay'
import { copyText } from '@/lib/clipboard'
import { cx } from '@/lib/cx'
import { formatDateTime } from '@/lib/dates'
import { useUI } from '@/state/ui'
import { SectionHeader } from './SettingsPage'

const CLIENTS: { value: McpToken['client']; label: string }[] = [
  { value: 'claude-desktop', label: 'Claude Desktop' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'other', label: 'その他' },
]
const clientLabel = (c: McpToken['client']) => CLIENTS.find((x) => x.value === c)?.label ?? c

/**
 * 繋ぎ方。アプリごとに、貼るだけの形で出す。トークンは発行直後だけ本物が入る。
 * 経路は画面と同じ 1 本(Cloudflare Access の内側)。アプリは Access のサービストークン(CF-Access-Client-Id / Secret)を
 * ヘッダで渡して門を通り、アプリのトークン(Authorization)で利用者になる(06 §7)
 */
const ACCESS_ID = '<Access のサービストークンの ID>'
const ACCESS_SECRET = '<Access のサービストークンの Secret>'

function snippets(endpoint: string, secret: string | null) {
  const token = secret ?? '<発行したトークン>'
  const headers = { Authorization: `Bearer ${token}`, 'CF-Access-Client-Id': ACCESS_ID, 'CF-Access-Client-Secret': ACCESS_SECRET }
  return {
    'claude-desktop': {
      title: 'Claude Desktop — claude_desktop_config.json に足す',
      body: JSON.stringify({ mcpServers: { works: { type: 'http', url: endpoint, headers } } }, null, 2),
    },
    'claude-code': {
      title: 'Claude Code — ターミナルで 1 回',
      body: `claude mcp add --transport http works ${endpoint} \\\n  --header "Authorization: Bearer ${token}" \\\n  --header "CF-Access-Client-Id: ${ACCESS_ID}" \\\n  --header "CF-Access-Client-Secret: ${ACCESS_SECRET}"`,
    },
    codex: {
      title: 'Codex — ~/.codex/config.toml に足す',
      body: `[mcp_servers.works]\nurl = "${endpoint}"\nhttp_headers = { Authorization = "Bearer ${token}", "CF-Access-Client-Id" = "${ACCESS_ID}", "CF-Access-Client-Secret" = "${ACCESS_SECRET}" }`,
    },
    other: {
      title: 'ほかの MCP クライアント',
      body: `URL: ${endpoint}\nヘッダ: Authorization: Bearer ${token}\n      CF-Access-Client-Id: ${ACCESS_ID}\n      CF-Access-Client-Secret: ${ACCESS_SECRET}\nトランスポート: Streamable HTTP`,
    },
  } as const
}

function Snippet({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-lg shadow-[inset_0_0_0_1px_var(--line)]">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h4 className="min-w-0 flex-1 truncate text-sm font-bold">{title}</h4>
        <IconButton label="コピー" onClick={() => void copyText(body, 'コピーしました')}>
          <Copy size={14} />
        </IconButton>
      </header>
      <pre className="overflow-x-auto px-3 py-2.5 font-sans text-sm leading-5 whitespace-pre text-ink-2">{body}</pre>
    </section>
  )
}

function IssueDialog({ onClose, onIssued }: { onClose: () => void; onIssued: (secret: string, client: McpToken['client']) => void }) {
  const [name, setName] = useState('')
  const [client, setClient] = useState<McpToken['client']>('claude-desktop')
  const qc = useQueryClient()
  const toast = useUI((s) => s.toast)
  const create = useMutation({
    mutationFn: () => api.createMcpToken(name, client),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['mcp-tokens'] })
      onIssued(res.secret, client)
    },
    onError: (e) => toast({ message: e instanceof ApiError ? e.message : '発行できませんでした', tone: 'danger' }),
  })
  return (
    <Modal label="トークンを発行" onClose={onClose} className="max-w-[460px]">
      <form
        className="flex flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate()
        }}
      >
        <header className="px-5 pt-5 pb-3">
          <h2 className="text-lg font-bold">トークンを発行</h2>
          <p className="mt-0.5 text-sm text-ink-2">繋ぐアプリごとに 1 本。全文はこのあと 1 回だけ見られます</p>
        </header>
        <div className="grid gap-3 px-5 pb-5">
          <label className="grid gap-1 text-sm text-ink-2">
            名前
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Surface の Claude Desktop"
              className="h-9 rounded-md bg-paper px-2 text-base text-ink outline-none shadow-[inset_0_0_0_1px_var(--line-strong)] placeholder:text-ink-3 focus:shadow-[inset_0_0_0_1.5px_var(--accent)]"
            />
          </label>
          <div className="grid gap-1 text-sm text-ink-2">
            繋ぐアプリ
            <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="繋ぐアプリ">
              {CLIENTS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={client === c.value}
                  onClick={() => setClient(c.value)}
                  className={cx('h-9 rounded-md text-base', client === c.value ? 'bg-accent-wash font-bold text-accent-ink' : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-sunken')}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-line bg-chrome px-5 py-3">
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" type="submit" disabled={!name.trim() || create.isPending}>
            発行する
          </Button>
        </footer>
      </form>
    </Modal>
  )
}

/**
 * MCP の設定。Claude Desktop・Claude Code・Codex から、このワークスペースのレコードを読み書きするための入口。
 * 認証はトークン(利用者ごと・アプリごと)。どのアプリから繋がっているかは、トークンの最終利用で見える
 */
export function McpSettings() {
  const meta = useOutletContext<MetaResponse>()
  const qc = useQueryClient()
  const toast = useUI((s) => s.toast)
  const tokens = useQuery({ queryKey: ['mcp-tokens'], queryFn: () => api.listMcpTokens() })
  const [issuing, setIssuing] = useState(false)
  const [issued, setIssued] = useState<{ secret: string; client: McpToken['client'] } | null>(null)
  const [tab, setTab] = useState<McpToken['client']>('claude-desktop')
  const endpoint = `${location.origin}/mcp`
  // 「7 日以内に使われたか」の基準。描画のたびに変わらないよう 1 回だけ取る
  const [now] = useState(() => Date.now())
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeMcpToken(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mcp-tokens'] })
      toast({ message: 'トークンを失効しました。そのアプリからは繋がらなくなります' })
    },
  })
  const all = tokens.data ?? []
  const snippet = snippets(endpoint, issued?.secret ?? null)

  return (
    <>
      <SectionHeader title="MCP" hint="Claude Desktop・Claude Code・Codex から、このワークスペースのレコードを読み書きできます。画面と同じ経路を通るので、業務ルールも同じです">
        <Button variant="primary" onClick={() => setIssuing(true)}>
          <Plus size={15} strokeWidth={2.5} aria-hidden />
          トークンを発行
        </Button>
      </SectionHeader>

      <div className="grid gap-8 px-5 pb-10 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h3 className="mb-2 font-bold">接続先</h3>
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 shadow-[inset_0_0_0_1px_var(--line)]">
            <code className="min-w-0 flex-1 truncate font-sans text-base">{endpoint}</code>
            <IconButton label="接続先をコピー" onClick={() => void copyText(endpoint, '接続先をコピーしました')}>
              <Copy size={14} />
            </IconButton>
          </div>
          <p className="mt-1.5 text-sm text-ink-3">Streamable HTTP。経路は画面と同じ(Cloudflare Access の内側)。アプリは Access のサービストークンをヘッダで渡して門を通り、上のトークンで利用者になります。サービストークンは Cloudflare の Zero Trust で発行し、右の設定の 2 か所に入れます</p>

          <h3 className="mt-8 mb-2 font-bold">繋がっているアプリ</h3>
          {all.length === 0 ? (
            <p className="text-sm text-ink-3">まだありません。トークンを発行して、アプリに設定してください</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-line p-0 shadow-[inset_0_0_0_1px_var(--line)] rounded-lg">
              {all.map((t) => {
                const owner = meta.users.find((u) => u.id === t.created_by)
                const live = t.last_used_at && now - new Date(t.last_used_at).getTime() < 7 * 86400000
                return (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className={cx('grid size-8 flex-none place-items-center rounded-full', live ? 'bg-accent-wash text-accent-ink' : 'bg-sunken text-ink-3')}>
                      <KeyRound size={15} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-bold">{t.name}</span>
                        <Tag color={live ? 'green' : 'gray'}>{clientLabel(t.client)}</Tag>
                      </span>
                      <span className="block truncate text-sm text-ink-3">
                        {t.prefix}… · {t.last_used_at ? `最終利用 ${formatDateTime(t.last_used_at)}` : 'まだ使われていません'} · 発行 {formatDateTime(t.created_at)}
                      </span>
                    </span>
                    {owner && <Avatar name={owner.name} color={owner.avatar_color} size={20} />}
                    <IconButton label={`「${t.name}」を失効`} className="hover:bg-danger-wash hover:text-danger" onClick={() => revoke.mutate(t.id)}>
                      <Trash2 size={14} />
                    </IconButton>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-1.5 text-sm text-ink-3">7 日以内に使われたものを緑で出します。心当たりの無いものは失効してください</p>
        </div>

        <div className="min-w-0">
          <h3 className="mb-2 font-bold">繋ぎ方</h3>
          {issued && (
            <div className="mb-3 rounded-lg bg-accent-wash p-3 text-accent-ink">
              <p className="flex items-center gap-1.5 font-bold">
                <Check size={15} aria-hidden />
                トークンを発行しました。下の設定にはもう入っています
              </p>
              <p className="mt-1 text-sm">この画面を離れると全文は二度と見られません。先にアプリへ貼るか、コピーしておいてください</p>
              <div className="mt-2 flex items-center gap-2 rounded-md bg-paper px-2 py-1.5">
                <code className="min-w-0 flex-1 truncate font-sans text-sm text-ink">{issued.secret}</code>
                <IconButton label="トークンをコピー" onClick={() => void copyText(issued.secret, 'トークンをコピーしました')}>
                  <Copy size={14} />
                </IconButton>
              </div>
            </div>
          )}
          <div role="tablist" aria-label="アプリ" className="mb-2 flex gap-0.5">
            {CLIENTS.map((c) => (
              <button
                key={c.value}
                type="button"
                role="tab"
                aria-selected={tab === c.value}
                onClick={() => setTab(c.value)}
                className={cx('h-8 rounded-md px-2.5 text-sm', tab === c.value ? 'bg-sunken font-bold text-ink' : 'text-ink-2 hover:text-ink')}
              >
                {c.label}
              </button>
            ))}
          </div>
          <Snippet title={snippet[tab].title} body={snippet[tab].body} />
          <ol className="mt-3 grid gap-1 pl-5 text-sm text-ink-2">
            <li>上の設定をアプリに貼る(トークンは発行したものに置き換える)</li>
            <li>アプリを再起動するか、MCP を読み直す</li>
            <li>「取引先を一覧して」などと頼むと、このワークスペースを読み書きできる。使われると、左の一覧の最終利用が更新される</li>
          </ol>
        </div>
      </div>

      {issuing && (
        <IssueDialog
          onClose={() => setIssuing(false)}
          onIssued={(secret, client) => {
            setIssuing(false)
            setIssued({ secret, client })
            setTab(client)
          }}
        />
      )}
    </>
  )
}
