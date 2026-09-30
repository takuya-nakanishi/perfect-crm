import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Menu, PanelLeft } from 'lucide-react'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { api, ApiError } from '@/api/client'
import type { Account, AccountSession, TotpSetup } from '@/api/types'
import { CodeInput, inputCls, TotpSecretView } from '@/components/auth/TotpParts'
import { Avatar, Button, IconButton } from '@/components/ui/basics'
import { keys, useSession } from '@/data/queries'
import { cleanCode } from '@/lib/code'
import { formatDateTime } from '@/lib/dates'
import { useUI } from '@/state/ui'

function Section({ title, hint, action, children }: { title: string; hint: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className="border-t border-line py-5">
      {/* 狭い画面では、ボタンを見出しの下へ回す(見出しと説明を細い列に押し込めない) */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="mt-0.5 text-ink-2">{hint}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-3 rounded-lg bg-danger-wash px-3 py-2 text-danger">
      {children}
    </p>
  )
}

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

/** 10 分以内のログインが要ると言われたら、入り直してここへ戻る(05 §15) */
function useRelogin() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  return async () => {
    await api.logout()
    qc.clear()
    navigate('/login?next=/account', { replace: true })
  }
}

function PasswordSection({ account }: { account: Account }) {
  const qc = useQueryClient()
  const toast = useUI((s) => s.toast)
  const relogin = useRelogin()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<{ text: string; relogin: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const needCurrent = account.has_password && !account.recent_login

  const close = () => {
    setOpen(false)
    setCurrent('')
    setNext('')
    setError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.changePassword(needCurrent ? { current_password: current, new_password: next } : { new_password: next })
      close()
      toast({ message: 'パスワードを変えました。ほかの端末とアプリはログアウトしました' })
      await qc.invalidateQueries({ queryKey: keys.account })
    } catch (err) {
      setError({ text: message(err, '変えられませんでした'), relogin: err instanceof ApiError && err.code === 'reauth_required' && !account.has_password })
    }
    setBusy(false)
  }

  const hint = account.has_password
    ? account.password_changed_at
      ? `最終変更 ${formatDateTime(account.password_changed_at)}`
      : '設定済み'
    : 'まだ決めていません(Google だけで入っています)'
  return (
    <Section
      title="パスワード"
      hint={hint}
      action={
        !open && (
          <Button variant="outline" onClick={() => setOpen(true)}>
            {account.has_password ? '変更' : 'パスワードを決める'}
          </Button>
        )
      }
    >
      {open && (
        <form onSubmit={submit} className="mt-4 max-w-sm">
          {needCurrent && (
            <>
              <label htmlFor="current-password" className="block text-ink-2">
                いまのパスワード
              </label>
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className={`${inputCls} mt-1.5 mb-4`}
              />
            </>
          )}
          <label htmlFor="new-password" className="block text-ink-2">
            新しいパスワード(15 文字以上)
          </label>
          <div className="relative mt-1.5">
            <input
              id="new-password"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus={!needCurrent}
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={`${inputCls} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'パスワードを隠す' : 'パスワードを表示'}
              aria-pressed={show}
              className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-ink-3 hover:text-ink"
            >
              {show ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
            </button>
          </div>
          <p className="mt-1.5 text-sm text-ink-3">文字の種類は問いません。長い文(空白や日本語も使えます)がおすすめです。変えると、この端末以外はログアウトします。</p>
          {error && (
            <Alert>
              {error.text}
              {error.relogin && (
                <button type="button" onClick={() => void relogin()} className="ml-2 font-bold underline">
                  ログインし直す
                </button>
              )}
            </Alert>
          )}
          <div className="mt-4 flex gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? '変えています…' : account.has_password ? '変える' : '決める'}
            </Button>
            <Button onClick={close}>やめる</Button>
          </div>
        </form>
      )}
    </Section>
  )
}

function TotpSection({ account }: { account: Account }) {
  const qc = useQueryClient()
  const toast = useUI((s) => s.toast)
  const relogin = useRelogin()
  const [setup, setSetup] = useState<TotpSetup | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<{ text: string; relogin: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const codeRef = useRef<HTMLInputElement>(null)

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      setSetup(await api.startTotpSetup())
      setCode('')
    } catch (err) {
      setError({ text: message(err, '始められませんでした'), relogin: err instanceof ApiError && err.code === 'reauth_required' })
    }
    setBusy(false)
  }

  const confirm = async (value: string) => {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      await api.confirmTotpSetup(cleanCode(value))
      setSetup(null)
      toast({ message: account.totp_enabled_at ? '2 段階認証を設定し直しました。前の端末のコードは使えません' : '2 段階認証を設定しました' })
      await qc.invalidateQueries({ queryKey: keys.account })
    } catch (err) {
      setError({ text: message(err, '確かめられませんでした'), relogin: false })
      setCode('')
      codeRef.current?.focus()
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <Section
      title="2 段階認証"
      hint={
        account.totp_enabled_at
          ? `認証アプリ(${formatDateTime(account.totp_enabled_at)} に設定)。パスワードで入るときに 6 桁を使います`
          : 'まだ設定していません。次にパスワードで入るときにも設定できます'
      }
      action={
        !setup && (
          <Button variant="outline" onClick={() => void start()} disabled={busy}>
            {account.totp_enabled_at ? 'やり直す' : '設定する'}
          </Button>
        )
      }
    >
      {error && !setup && (
        <Alert>
          {error.text}
          {error.relogin && (
            <button type="button" onClick={() => void relogin()} className="ml-2 font-bold underline">
              ログインし直す
            </button>
          )}
        </Alert>
      )}
      {setup && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void confirm(code)
          }}
          className="mt-4 max-w-md"
        >
          <p className="mb-4 text-ink-2">認証アプリ(Google Authenticator など)で読み取り、表示された 6 桁を入れてください。</p>
          <TotpSecretView setup={setup} />
          <label htmlFor="totp-code" className="mt-5 block text-ink-2">
            表示された 6 桁
          </label>
          <CodeInput
            id="totp-code"
            className="mt-1.5 max-w-[220px]"
            value={code}
            onChange={setCode}
            onComplete={(v) => void confirm(v)}
            inputRef={codeRef}
          />
          {error && <Alert>{error.text}</Alert>}
          <div className="mt-4 flex gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? '確かめています…' : account.totp_enabled_at ? '入れ替える' : '設定する'}
            </Button>
            <Button
              onClick={() => {
                setSetup(null)
                setError(null)
              }}
            >
              やめる
            </Button>
          </div>
        </form>
      )}
    </Section>
  )
}

function SessionRow({ s, onRevoke }: { s: AccountSession; onRevoke: () => void }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{s.label}</span>
          {s.current && <span className="rounded-[5px] bg-accent-wash px-1.5 text-sm text-accent-ink">この端末</span>}
          {s.kind === 'app' && <span className="rounded-[5px] bg-sunken px-1.5 text-sm text-ink-2">アプリ</span>}
        </p>
        <p className="text-sm text-ink-3">
          最終 {s.current ? 'いま' : formatDateTime(s.last_seen_at)} · ログイン {formatDateTime(s.created_at)}
        </p>
      </div>
      {!s.current && (
        <Button size="sm" variant="outline" onClick={onRevoke}>
          ログアウト
        </Button>
      )}
    </li>
  )
}

function SessionsSection() {
  const qc = useQueryClient()
  const toast = useUI((s) => s.toast)
  const sessions = useQuery({ queryKey: keys.accountSessions, queryFn: () => api.listAccountSessions() })
  const list = sessions.data ?? []
  const others = list.filter((s) => !s.current)

  // 切るのは確認を挟まない(切られた側は入り直せば戻る。05 §15)
  const run = async (task: Promise<void>, done: string) => {
    try {
      await task
      toast({ message: done })
    } catch (err) {
      toast({ message: message(err, 'ログアウトできませんでした'), tone: 'danger' })
    }
    await qc.invalidateQueries({ queryKey: keys.accountSessions })
  }

  return (
    <Section
      title="ログイン中の端末とアプリ"
      hint="心当たりの無いものは、ログアウトしてください。この端末のログアウトは、左上のメニューから"
      action={
        others.length > 0 && (
          <Button variant="outline" onClick={() => void run(api.revokeOtherAccountSessions(), 'ほかの端末をすべてログアウトしました')}>
            ほかをすべてログアウト
          </Button>
        )
      }
    >
      <ul className="m-0 mt-2 list-none divide-y divide-line p-0">
        {list.map((s) => (
          <SessionRow key={s.id} s={s} onRevoke={() => void run(api.revokeAccountSession(s.id), `${s.label} をログアウトしました`)} />
        ))}
      </ul>
    </Section>
  )
}

/**
 * アカウント(05 §15)。だれでも開ける(自分のことだけ)。パスワード・2 段階認証・ログイン中の端末。
 * パスワードと 2 段階認証を変えるには、10 分以内のログインか、いまのパスワードが要る(03 §5)
 */
export function AccountPage() {
  const session = useSession()
  const account = useQuery({ queryKey: keys.account, queryFn: () => api.getAccount() })
  const sidebarCollapsed = useUI((s) => s.sidebarCollapsed)
  const toggleSidebar = useUI((s) => s.toggleSidebar)
  const setMobileNav = useUI((s) => s.setMobileNav)
  const user = session.data?.user

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-12 flex-none items-center gap-2 border-b border-line pr-3 pl-3 md:pl-5">
        <IconButton label="メニューを開く" className="md:hidden" onClick={() => setMobileNav(true)}>
          <Menu size={17} />
        </IconButton>
        {sidebarCollapsed && (
          <IconButton label="サイドバーを開く (M)" className="hidden md:inline-grid" onClick={toggleSidebar}>
            <PanelLeft size={16} />
          </IconButton>
        )}
        <h1 className="truncate text-lg font-bold">アカウント</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-5 pb-10 md:px-8">
          {user && (
            <div className="flex items-center gap-3 py-6">
              <Avatar name={user.name} color={user.avatar_color} size={40} />
              <div className="min-w-0">
                <p className="truncate text-lg font-bold">{user.name}</p>
                <p className="truncate text-ink-2">{user.email}</p>
              </div>
            </div>
          )}
          {account.error && <Alert>{message(account.error, 'アカウントを読めませんでした')}</Alert>}
          {account.data && (
            <>
              <PasswordSection account={account.data} />
              {account.data.has_password && <TotpSection account={account.data} />}
            </>
          )}
          <SessionsSection />
        </div>
      </div>
    </div>
  )
}
