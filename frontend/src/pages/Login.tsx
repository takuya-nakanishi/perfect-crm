import { useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { api, ApiError, API_MODE } from '@/api/client'
import type { LoginResult, Session, TotpSetup } from '@/api/types'
import { ProviderMark } from '@/components/auth/ProviderMark'
import { CodeInput, inputCls, TotpSecretView } from '@/components/auth/TotpParts'
import { CloverMark } from '@/components/shell/CloverMark'
import { keys, useSession, useSessionOptions } from '@/data/queries'
import { cleanCode } from '@/lib/code'
import { enabledProviders, LOGIN_PROVIDERS, linkedProvider, providerError, providerLabel, providerLoginUrl, safeNext } from '@/lib/login'
import { useUI } from '@/state/ui'

const primaryCls =
  'h-10 w-full rounded-lg bg-accent text-lg font-bold text-on-accent transition-colors duration-100 hover:bg-accent-strong disabled:opacity-60'

const KEYS: { key: string; label: string }[] = [
  { key: 'Q', label: '思いついたタスクを、その場で追加' },
  { key: '/', label: '取引先も商談も、ひとつの検索欄から' },
  { key: 'E', label: '終わったタスクは一打で完了' },
]

type Step = { kind: 'credentials' } | { kind: 'resuming' } | { kind: 'totp' } | { kind: 'totp_setup'; setup: TotpSetup }

const stepOf = (result: Exclude<LoginResult, { status: 'ok' }>): Step =>
  result.status === 'totp' ? { kind: 'totp' } : { kind: 'totp_setup', setup: result.setup }

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <CloverMark size={30} animated />
      <span className="text-xl font-bold tracking-tight">Works</span>
    </div>
  )
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-3 rounded-lg bg-danger-wash px-3 py-2 text-danger">
      {children}
    </p>
  )
}

/**
 * セッションを確かめられなかったとき(api が止まっている・通信が切れた)。
 * 未ログイン(401)はここに来ない(getSession が null を返し、フォームを出す)
 */
function Unreachable({ error, next }: { error: Error; next: string }) {
  return (
    <div className="w-full max-w-[340px]">
      <Brand />
      <h1 className="mt-10 text-2xl font-bold tracking-tight">Works に繋がりません</h1>
      <Alert>{error instanceof ApiError ? error.message : '通信できませんでした'}</Alert>
      <p className="mt-3 text-ink-2">通信か、Works の側が止まっている可能性があります。少し待ってから読み込み直してください。</p>
      <button type="button" onClick={() => window.location.assign(next)} className={`mt-6 ${primaryCls}`}>
        読み込み直す
      </button>
    </div>
  )
}

export function Login() {
  const session = useSession()
  const options = useSessionOptions()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useUI((s) => s.toast)
  const [params, setParams] = useSearchParams()
  // Microsoft で確かめて戻ってきた(?continue=microsoft)。2 段目(6 桁)を読み直して続ける(03 §5)
  const via = linkedProvider(params.get('continue'))
  const [step, setStep] = useState<Step>(via ? { kind: 'resuming' } : { kind: 'credentials' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(
    () =>
      providerError(params.get('error')) ??
      (params.get('expired') ? 'ログインが切れました(期限か、ほかの端末で切られた)。もう一度ログインしてください' : null),
  )
  const [busy, setBusy] = useState(false)
  // 続けて失敗して待たされているあいだ(429 の Retry-After)は、送るボタンを押せなくする
  const [waiting, setWaiting] = useState(false)
  const sending = useRef(false)
  const codeRef = useRef<HTMLInputElement>(null)

  // 戻り先はアプリ内のパスに限る(外部 URL へ飛ばされないように)
  const next = safeNext(params.get('next'))

  useEffect(() => {
    if (!via) return
    let alive = true
    api.resumeLogin().then(
      (result) => {
        if (alive && result.status !== 'ok') setStep(stepOf(result))
      },
      (err: unknown) => {
        if (!alive) return
        setError(err instanceof ApiError ? err.message : '確かめられませんでした。もう一度ログインしてください')
        setStep({ kind: 'credentials' })
      },
    )
    return () => {
      alive = false
    }
  }, [via])

  if (session.data) return <Navigate to={next} replace />
  if (session.isPending) return <div className="min-h-dvh bg-paper" />

  const fail = (err: unknown, fallback: string) => {
    setError(err instanceof ApiError ? err.message : fallback)
    if (err instanceof ApiError && err.status === 429 && err.retryAfter) {
      setWaiting(true)
      window.setTimeout(() => setWaiting(false), err.retryAfter * 1000)
    }
  }

  const done = (result: Session, setUp: boolean) => {
    qc.setQueryData(keys.session, result)
    if (setUp) toast({ message: '2 段階認証を設定しました' })
    navigate(next, { replace: true })
  }

  const submitCredentials = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await api.login(email, password)
      if (result.status === 'ok') return done(result.session, false)
      setCode('')
      setStep(stepOf(result))
    } catch (err) {
      fail(err, 'ログインできませんでした。もう一度お試しください')
    }
    setBusy(false)
  }

  const submitCode = async (value: string) => {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      done(await api.verifyTotp(cleanCode(value)), step.kind === 'totp_setup')
    } catch (err) {
      fail(err, '確かめられませんでした。もう一度お試しください')
      if (err instanceof ApiError && err.code === 'login_expired') {
        setPassword('')
        setStep({ kind: 'credentials' })
        dropContinue()
      } else {
        setCode('')
        // 1 フレーム遅らせない(続けて打った数字が前の値に混ざらないように。runbook §4)
        codeRef.current?.focus()
      }
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  /** Microsoft から戻った印を URL から外す(読み込み直しても 2 段目を探しに行かない) */
  const dropContinue = () => {
    if (via) {
      setParams(
        (p) => {
          p.delete('continue')
          return p
        },
        { replace: true },
      )
    }
  }

  const backToCredentials = () => {
    setStep({ kind: 'credentials' })
    setPassword('')
    setError(null)
    dropContinue()
  }

  // 使える提供元(パスワードを忘れたときの案内に挙げる)。ボタンは設定が無くても出す(05 §15)
  const providers = enabledProviders(options.data)
  const viaLabel = via ? providerLabel(via) : null
  const codeForm = (title: string, lead: ReactNode, button: string, extra?: ReactNode) => (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submitCode(code)
      }}
      className="w-full max-w-[340px]"
    >
      <Brand />
      <h1 className="mt-10 text-2xl font-bold tracking-tight">{title}</h1>
      <div className="mt-1.5 text-ink-2">{lead}</div>
      {extra}
      <label htmlFor="code" className="mt-6 block text-ink-2">
        {step.kind === 'totp_setup' ? '表示された 6 桁' : '確認コード'}
      </label>
      <CodeInput
        className="mt-1.5"
        value={code}
        onChange={setCode}
        onComplete={(v) => void submitCode(v)}
        // 送っている間も欄は生かす(外れたら、すぐ次を打てるようにフォーカスを戻すため)。二重送信は sending で防ぐ
        disabled={waiting}
        inputRef={codeRef}
      />
      {error && <Alert>{error}</Alert>}
      <button type="submit" disabled={busy || waiting} className={`mt-6 ${primaryCls}`}>
        {busy ? '確かめています…' : button}
      </button>
      <button type="button" onClick={backToCredentials} className="mt-4 text-ink-2 hover:text-ink hover:underline">
        {viaLabel ? '← ログインの方法を選び直す' : '← メールアドレスからやり直す'}
      </button>
    </form>
  )

  let body: ReactNode
  if (session.error) {
    body = <Unreachable error={session.error} next={next} />
  } else if (step.kind === 'resuming') {
    body = (
      <div className="w-full max-w-[340px]" aria-busy>
        <Brand />
      </div>
    )
  } else if (step.kind === 'totp') {
    body = codeForm(
      '確認コード',
      viaLabel ? `${viaLabel} で確かめました。続けて、認証アプリに出ている 6 桁を入れてください。` : '認証アプリに出ている 6 桁を入れてください。',
      '確かめる',
    )
  } else if (step.kind === 'totp_setup') {
    const { setup } = step
    body = codeForm(
      '2 段階認証を設定する',
      <>
        {viaLabel ? `${viaLabel} で入るとき` : 'パスワードで入るとき'}
        は、認証アプリ(Google Authenticator など)の 6 桁も使います。アプリで QR を読み取ってください。
      </>,
      '設定してログイン',
      <div className="mt-5">
        <TotpSecretView setup={setup} />
      </div>,
    )
  } else {
    body = (
      <form onSubmit={submitCredentials} className="w-full max-w-[340px]">
        <Brand />
        <h1 className="mt-10 text-2xl font-bold tracking-tight">ログイン</h1>
        <p className="mt-1.5 text-ink-2">取引先・商談・タスクを、ひとつの場所で。</p>

        <label htmlFor="email" className="mt-8 block text-ink-2">
          メールアドレス
        </label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.jp"
          className={`${inputCls} mt-1.5`}
        />

        <label htmlFor="password" className="mt-4 block text-ink-2">
          パスワード
        </label>
        <div className="relative mt-1.5">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputCls} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-ink-3 hover:text-ink"
          >
            {showPassword ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
          </button>
        </div>

        {error && <Alert>{error}</Alert>}

        <button type="submit" disabled={busy || waiting} className={`mt-6 ${primaryCls}`}>
          {busy ? 'ログインしています…' : 'ログイン'}
        </button>

        <div className="my-5 flex items-center gap-3 text-sm text-ink-3" aria-hidden>
          <span className="h-px flex-1 bg-line" />
          または
          <span className="h-px flex-1 bg-line" />
        </div>
        <div className="flex flex-col gap-2.5">
          {LOGIN_PROVIDERS.map((p) => (
            // ページごと提供元へ移るのでリンク(fetch しない。04 §16)。
            // 設定の無い提供元は、移らずにその旨の帯を出す(サーバへ行っても同じ帯で戻ってくる)
            <a
              key={p}
              href={providerLoginUrl(p, next)}
              onClick={(e) => {
                if (options.data && !options.data[p]) {
                  e.preventDefault()
                  setError(providerError(`${p}_not_configured`))
                }
              }}
              className="flex h-10 w-full items-center justify-center gap-2.5 rounded-lg text-lg font-bold text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] transition-colors duration-100 hover:bg-sunken"
            >
              <ProviderMark provider={p} />
              {providerLabel(p)} でログイン
            </a>
          ))}
        </div>

        <p className="mt-6 text-sm text-ink-3">
          {providers.length > 0
            ? `パスワードを忘れたときは、${providers.map(providerLabel).join(' か ')} でログインしてアカウントの画面で決め直せます。結んでいなければ、管理者に頼んでください。`
            : 'パスワードを忘れたときは、管理者に頼んでください。'}
        </p>

        {API_MODE === 'mock' && (
          <p className="mt-4 rounded-lg bg-chrome px-3 py-2.5 text-sm text-ink-2">
            いまはモックの画面です。メールアドレスとパスワードは何を入れても入れます(2 段階認証も出ません)。データはこのブラウザの中だけに保存されます。
          </p>
        )}
      </form>
    )
  }

  return (
    <div className="grid min-h-dvh bg-paper text-ink lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex items-center justify-center px-6 py-12">{body}</main>

      <aside className="relative hidden overflow-hidden bg-chrome lg:block" aria-hidden>
        <div className="absolute -top-24 -right-28 opacity-90">
          <CloverMark size={520} animated />
        </div>
        <div className="absolute inset-x-0 bottom-0 px-14 pb-16">
          <p className="text-3xl leading-[1.35] font-bold tracking-tight">
            <span className="block">キーボードから手を離さずに、</span>
            <span className="block">今日の仕事を片付ける。</span>
          </p>
          <ul className="m-0 mt-8 flex list-none flex-col gap-3.5 p-0">
            {KEYS.map((k) => (
              <li key={k.key} className="flex items-center gap-3.5 text-lg text-ink-2">
                <kbd className="kbd h-7 min-w-7 rounded-md font-sans text-base">{k.key}</kbd>
                {k.label}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}
