import { useQuery } from '@tanstack/react-query'
import { Check, Minus } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router'
import { api, ApiError } from '@/api/client'
import { CloverMark } from '@/components/shell/CloverMark'
import { useSession } from '@/data/queries'

const CAN = ['取引先・取引先責任者・商談・タスク・活動を読む、探す', 'レコードを作る、書き換える(タスクの完了も)']
const CANNOT = ['レコードやテーブルを消す', '環境設定(テーブルの定義・Web フォーム・トークン)を変える']

/**
 * Claude のカスタムコネクタから繋ぐときの許可の画面(04 §13)。/authorize がここへ送る。
 * Access の内側なので、見ているのは Access でログインした本人。許可すると、その人として MCP が使える。
 * 決めたら Claude の戻り先へ移る(Claude の画面に「接続しました」が出る)
 */
export function OAuthConsent() {
  const session = useSession()
  const location = useLocation()
  const [params] = useSearchParams()
  const id = params.get('request') ?? ''
  const request = useQuery({
    queryKey: ['oauth-request', id],
    queryFn: () => api.getOAuthRequest(id),
    enabled: Boolean(session.data && id),
    retry: false,
  })
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (session.isPending) return <div className="min-h-dvh bg-paper" />
  if (!session.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />

  const decide = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'deny')
    setError(null)
    try {
      const { redirect_url } = await api.decideOAuthRequest(id, approve)
      window.location.assign(redirect_url)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '決められませんでした。Claude からもう一度繋いでください')
      setBusy(null)
    }
  }

  const user = session.data.user
  const failed = request.error ?? (id ? null : new Error('許可の依頼が指定されていません'))
  return (
    <div className="grid min-h-dvh place-items-center bg-chrome px-5 py-10 text-ink">
      <main className="w-full max-w-[420px] rounded-xl bg-paper p-6 shadow-card sm:p-8">
        <div className="flex items-center gap-2.5">
          <CloverMark size={26} />
          <span className="text-lg font-bold tracking-tight">Works</span>
        </div>

        {failed ? (
          <>
            <h1 className="mt-8 text-xl font-bold tracking-tight">繋げませんでした</h1>
            <p role="alert" className="mt-3 rounded-lg bg-danger-wash px-3 py-2 text-danger">
              {failed.message}
            </p>
          </>
        ) : !request.data ? (
          <div className="h-60" />
        ) : (
          <>
            <h1 className="mt-8 text-xl leading-snug font-bold tracking-tight">
              {request.data.client_name} に Works を使わせますか?
            </h1>
            <p className="mt-2 text-ink-2">
              <span className="font-bold text-ink">{user.name}</span>({user.email})として、次のことができるようになります。
            </p>
            <ul className="m-0 mt-4 grid list-none gap-2 p-0">
              {CAN.map((t) => (
                <li key={t} className="flex gap-2">
                  <Check size={16} className="mt-0.5 flex-none text-accent" aria-hidden />
                  {t}
                </li>
              ))}
              {CANNOT.map((t) => (
                <li key={t} className="flex gap-2 text-ink-3">
                  <Minus size={16} className="mt-0.5 flex-none" aria-hidden />
                  {t}(できない)
                </li>
              ))}
            </ul>
            <p className="mt-4 rounded-lg bg-chrome px-3 py-2 text-sm text-ink-2">
              許可すると <span className="font-bold text-ink">{request.data.redirect_host}</span> へ戻ります。
              心当たりが無ければ断ってください。あとから 環境設定 › MCP で切れます。
            </p>
            {error && (
              <p role="alert" className="mt-3 rounded-lg bg-danger-wash px-3 py-2 text-danger">
                {error}
              </p>
            )}
            <div className="mt-6 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void decide(false)}
                className="h-10 rounded-lg text-lg text-ink-2 shadow-[inset_0_0_0_1px_var(--line-strong)] transition-colors duration-100 hover:bg-sunken hover:text-ink disabled:opacity-60"
              >
                {busy === 'deny' ? '戻っています…' : '断る'}
              </button>
              <button
                type="button"
                autoFocus
                disabled={busy !== null}
                onClick={() => void decide(true)}
                className="h-10 rounded-lg bg-accent text-lg font-bold text-on-accent transition-colors duration-100 hover:bg-accent-strong disabled:opacity-60"
              >
                {busy === 'approve' ? '繋いでいます…' : '許可する'}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
