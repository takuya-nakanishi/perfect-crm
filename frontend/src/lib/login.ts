import type { LoginProvider, SessionOptions } from '@/api/types'

/**
 * Google・Microsoft でログイン(03 §5、04 §16、05 §15)の、画面が持つ決まり。
 * 提供元から戻ったときの理由の符号(`?error=google_not_registered` など)を文にし、戻り先を同じオリジンの中に限る
 */

export const LOGIN_PROVIDERS: readonly LoginProvider[] = ['google', 'microsoft']

const LABELS: Record<LoginProvider, string> = { google: 'Google', microsoft: 'Microsoft' }

export const providerLabel = (provider: LoginProvider): string => LABELS[provider]

/** ボタンを出す提供元(並びは固定) */
export const enabledProviders = (options: SessionOptions | undefined): LoginProvider[] =>
  LOGIN_PROVIDERS.filter((p) => options?.[p])

/**
 * 戻り先はアプリ内のパスに限る(外の URL へ飛ばされないように)。サーバの safe_next と同じ決まり:
 * `/` で始まり、`//` で始まらず、`\` と制御文字を含まない
 */
export function safeNext(value: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  if (value && value.startsWith('/') && !value.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(value)) return value
  return '/'
}

/** 「Google でログイン」の行き先。ページごと移る(fetch しない。04 §16) */
export const providerLoginUrl = (provider: LoginProvider, next: string): string =>
  `/api/v1/session/${provider}?next=${encodeURIComponent(safeNext(next))}`

const REASONS: Record<string, (label: string) => string> = {
  not_registered: (label) =>
    label === 'Microsoft'
      ? 'この Microsoft アカウントは Works に結ばれていません。パスワードか Google で入ってから、アカウントの画面で結んでください'
      : `この ${label} アカウントは Works に登録されていません`,
  denied: (label) => `${label} でのログインを取りやめました`,
  failed: (label) => `${label} でのログインに失敗しました。もう一度お試しください`,
  not_configured: (label) => `${label} でのログインは、まだ設定されていません`,
  busy: () => '続けて試されたため、少し待ってからもう一度お試しください',
  in_use: (label) => `この ${label} アカウントは、ほかの人に結ばれています`,
}

/** 提供元から戻ったときの理由の符号(`google_not_registered` など)を、帯に出す文にする。知らない符号は null */
export function providerError(code: string | null | undefined): string | null {
  const match = /^(google|microsoft)_([a-z_]+)$/.exec(code ?? '')
  if (!match) return null
  const reason = REASONS[match[2]]
  return reason ? reason(providerLabel(match[1] as LoginProvider)) : null
}

/** `?linked=google` の提供元(知らない値は null) */
export const linkedProvider = (value: string | null | undefined): LoginProvider | null =>
  LOGIN_PROVIDERS.find((p) => p === value) ?? null
