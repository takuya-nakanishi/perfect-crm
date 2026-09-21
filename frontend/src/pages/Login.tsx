import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { api, API_MODE } from '@/api/client'
import { CloverMark } from '@/components/shell/CloverMark'
import { keys, useSession } from '@/data/queries'

const inputCls =
  'h-10 w-full rounded-lg bg-paper px-3 text-lg text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none transition-shadow duration-100 placeholder:text-ink-3 focus:shadow-[inset_0_0_0_2px_var(--accent)]'

const KEYS: { key: string; label: string }[] = [
  { key: 'Q', label: '思いついたタスクを、その場で追加' },
  { key: '/', label: '取引先も商談も、ひとつの検索欄から' },
  { key: 'E', label: '終わったタスクは一打で完了' },
]

export function Login() {
  const session = useSession()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 戻り先はアプリ内のパスに限る(外部 URL へ飛ばされないように)
  const nextParam = params.get('next')
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/'
  if (session.data) return <Navigate to={next} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await api.login(email, password)
      qc.setQueryData(keys.session, result)
      navigate(next, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインできませんでした。もう一度試してください')
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh bg-paper text-ink lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-[340px]">
          <div className="flex items-center gap-2.5">
            <CloverMark size={30} animated />
            <span className="text-xl font-bold tracking-tight">Works</span>
          </div>
          <h1 className="mt-10 text-2xl font-bold tracking-tight">ログイン</h1>
          <p className="mt-1.5 text-ink-2">取引先・商談・タスクを、ひとつの場所で。</p>

          <label htmlFor="email" className="mt-8 block text-ink-2">
            メールアドレス
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
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
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputCls} mt-1.5`}
          />

          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-danger-wash px-3 py-2 text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-6 h-10 w-full rounded-lg bg-accent text-lg font-bold text-on-accent transition-colors duration-100 hover:bg-accent-strong disabled:opacity-60"
          >
            {busy ? 'ログインしています…' : 'ログイン'}
          </button>

          {API_MODE === 'mock' && (
            <p className="mt-6 rounded-lg bg-chrome px-3 py-2.5 text-sm text-ink-2">
              いまはモックの画面です。メールアドレスとパスワードは何を入れても入れます。データはこのブラウザの中だけに保存されます。
            </p>
          )}
        </form>
      </main>

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
