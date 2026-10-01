import { ApiError } from '@/api/client'
import type { Account, AccountSession, LoginProvider, TotpSetup } from '@/api/types'
import { cleanCode } from '@/lib/code'
import { providerLabel } from '@/lib/login'

/**
 * アカウントの擬似データ(05 §15、04 §16)。利用者ごとに localStorage に持つ。
 * モックはパスワードも 6 桁も確かめない(ログインそのものは pytest と、http の E2E で確かめる)。
 * パスワードの決まり(長さ・丸ごと同じもの)はサーバと同じ文で断る。漏えいした一覧には照らさない
 */
const KEY = 'works.mock.account.v1'
export const MOCK_SESSION_ID = 'mock-session'
const MIN_LENGTH = 15
const MAX_LENGTH = 256

interface Entry {
  password_changed_at: string | null
  totp_enabled_at: string | null
  pending_secret: string | null
  logged_in_at: string
}

type State = Record<string, Entry>

function load(): State {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as State) ?? {}
  } catch {
    return {}
  }
}

function entryOf(state: State, userId: string): Entry {
  return (state[userId] ??= {
    password_changed_at: null,
    // 種の利用者は設定済みとして見せる(アカウントの画面の見え方を確かめるため)
    totp_enabled_at: '2026-09-21T00:00:00.000Z',
    pending_secret: null,
    logged_in_at: new Date().toISOString(),
  })
}

function update(userId: string, patch: Partial<Entry>) {
  const state = load()
  Object.assign(entryOf(state, userId), patch)
  localStorage.setItem(KEY, JSON.stringify(state))
}

export function resetAccount() {
  localStorage.removeItem(KEY)
}

export function onLogin(userId: string) {
  update(userId, { logged_in_at: new Date().toISOString() })
}

export function getAccount(userId: string): Account {
  const entry = entryOf(load(), userId)
  return {
    has_password: true,
    password_changed_at: entry.password_changed_at,
    totp_enabled_at: entry.totp_enabled_at,
    google_email: null,
    microsoft_email: null,
    recent_login: Date.now() - Date.parse(entry.logged_in_at) <= 10 * 60 * 1000,
  }
}

/** モックは Google・Microsoft に繋がない。結ぶ・外すの口はサーバの「設定が無い」と同じ形で断る */
export function providerNotConfigured(provider: LoginProvider): ApiError {
  return new ApiError(409, 'not_configured', `${providerLabel(provider)} でのログインは、まだ設定されていません`)
}

/** サーバ(app/auth/passwords.py の problem)と同じ決まりと文。漏えいした一覧はモックでは見ない */
export function passwordProblem(password: string, context: string[]): string | null {
  const text = password.normalize('NFKC')
  const length = [...text].length
  if (length < MIN_LENGTH) return `パスワードは ${MIN_LENGTH} 文字以上にしてください`
  if (length > MAX_LENGTH) return `パスワードは ${MAX_LENGTH} 文字までにしてください`
  const folded = text.toLowerCase()
  if (context.filter(Boolean).some((c) => c.toLowerCase() === folded)) {
    return 'メールアドレス・名前・サービスの名前と同じパスワードは使えません'
  }
  return null
}

export function changePassword(userId: string, newPassword: string, context: string[]) {
  const problem = passwordProblem(newPassword, context)
  if (problem) throw new ApiError(400, 'weak_password', problem)
  update(userId, { password_changed_at: new Date().toISOString() })
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** QR の代わりの見本(モックは QR を作らない。白地に黒の枠と「モック」の字) */
const PLACEHOLDER_QR =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/>' +
      '<path d="M2 2h7v7H2zM20 2h7v7h-7zM2 20h7v7H2z" fill="none" stroke="#000" stroke-width="1.4"/>' +
      '<text x="14.5" y="16.5" font-size="4" text-anchor="middle" fill="#000">モック</text></svg>',
  )

export function startTotp(userId: string, email: string, issuer: string): TotpSetup {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const secret = [...bytes].map((b) => BASE32[b % 32]).join('')
  update(userId, { pending_secret: secret })
  const label = encodeURIComponent(`${issuer}:${email}`)
  return {
    secret,
    otpauth_uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`,
    qr_svg: PLACEHOLDER_QR,
  }
}

export function confirmTotp(userId: string, code: string) {
  if (!entryOf(load(), userId).pending_secret) throw new ApiError(400, 'totp_not_started', '設定を始めからやり直してください')
  if (cleanCode(code).length !== 6) {
    throw new ApiError(400, 'invalid_code', '確認コードが違います。認証アプリの 6 桁と、端末の時刻が合っているかを確かめてください')
  }
  update(userId, { pending_secret: null, totp_enabled_at: new Date().toISOString() })
}

/** 一覧に出す「Chrome · Windows」(サーバの sessions.describe と同じ見分け方) */
export function describeAgent(agent: string): string {
  const browsers: [string, string][] = [['Edg/', 'Edge'], ['OPR/', 'Opera'], ['Firefox/', 'Firefox'], ['Chrome/', 'Chrome'], ['Safari/', 'Safari']]
  const systems: [string, string][] = [['Android', 'Android'], ['iPhone', 'iPhone'], ['iPad', 'iPad'], ['Windows', 'Windows'], ['Mac OS X', 'Mac'], ['CrOS', 'ChromeOS'], ['Linux', 'Linux']]
  const browser = browsers.find(([mark]) => agent.includes(mark))?.[1] ?? 'ブラウザ'
  const system = systems.find(([mark]) => agent.includes(mark))?.[1]
  return system ? `${browser} · ${system}` : browser
}

/** モックのログインは 1 つだけ(この端末) */
export function listSessions(userId: string): AccountSession[] {
  const entry = entryOf(load(), userId)
  return [
    {
      id: MOCK_SESSION_ID,
      kind: 'browser',
      label: describeAgent(typeof navigator === 'undefined' ? '' : navigator.userAgent),
      created_at: entry.logged_in_at,
      last_seen_at: new Date().toISOString(),
      current: true,
    },
  ]
}
