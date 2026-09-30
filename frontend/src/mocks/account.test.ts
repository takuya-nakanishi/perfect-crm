import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import usersJson from './fixtures/users.json'
import { resetAccount } from './account'
import { resetTables } from './engine'
import { createMockClient } from './mockClient'

// テストケース表: docs/tests/auth.md。1 つの it が表の 1 行(ID をラベルに入れる)
// モックはパスワードも 6 桁も確かめない。ここで確かめるのは、画面が受け取る形と、決まりの文がサーバと同じこと

/** 呼んだ結果の ApiError(投げなければ null) */
async function errorOf(fn: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await fn()
    return null
  } catch (e) {
    if (e instanceof ApiError) return e
    throw e
  }
}

const admin = usersJson.find((u) => u.admin)!

describe('ログインとアカウント(mocks/account.ts・mockClient.ts)', () => {
  beforeEach(() => {
    localStorage.clear()
    resetTables()
    resetAccount()
  })

  it('AUTH-022 モックのログインは 2 段目を出さずに入り、2 段目の口は札が無いので login_expired', async () => {
    const api = createMockClient()
    const result = await api.login(admin.email, 'なんでも')
    expect(result.status).toBe('ok')
    expect(result.status === 'ok' && result.session.user.email).toBe(admin.email)
    expect((await api.getSession())?.user.id).toBe(admin.id)
    expect((await errorOf(() => api.verifyTotp('123456')))?.code).toBe('login_expired')
    expect(await api.getSessionOptions()).toEqual({ google: false })
  })

  it('AUTH-023 パスワードの決まり(15 文字以上・256 文字まで・メールアドレスと同じは不可)はサーバと同じ文で断る', async () => {
    const api = createMockClient()
    await api.login(admin.email, 'x')
    const short = await errorOf(() => api.changePassword({ new_password: 'あ'.repeat(14) }))
    expect(short?.status).toBe(400)
    expect(short?.code).toBe('weak_password')
    expect(short?.message).toBe('パスワードは 15 文字以上にしてください')
    expect((await errorOf(() => api.changePassword({ new_password: 'x'.repeat(257) })))?.message).toBe('パスワードは 256 文字までにしてください')
    expect((await errorOf(() => api.changePassword({ new_password: admin.email.toUpperCase() })))?.code).toBe('weak_password')
    expect(await errorOf(() => api.changePassword({ new_password: 'あ'.repeat(15) }))).toBeNull()
    expect((await api.getAccount()).password_changed_at).not.toBeNull()
  })

  it('AUTH-024 2 段階認証のやり直し: 設定の中身が返り、6 桁でなければ断り、6 桁で入れ替わる。始めていなければ totp_not_started', async () => {
    const api = createMockClient()
    await api.login(admin.email, 'x')
    expect((await errorOf(() => api.confirmTotpSetup('123456')))?.code).toBe('totp_not_started')
    const before = (await api.getAccount()).totp_enabled_at
    const setup = await api.startTotpSetup()
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(setup.otpauth_uri).toMatch(/^otpauth:\/\/totp\//)
    expect(setup.otpauth_uri).toContain(`secret=${setup.secret}`)
    expect(setup.qr_svg).toMatch(/^data:image\/svg\+xml,/)
    expect((await errorOf(() => api.confirmTotpSetup('12345')))?.code).toBe('invalid_code')
    await api.confirmTotpSetup('１２３ ４５６')
    expect((await api.getAccount()).totp_enabled_at).not.toBe(before)
  })

  it('AUTH-025 ログイン中の端末はこの端末 1 つ。ほかの id は 404、この端末を切るとログアウトする', async () => {
    const api = createMockClient()
    await api.login(admin.email, 'x')
    const [only, ...rest] = await api.listAccountSessions()
    expect(rest).toEqual([])
    expect(only).toMatchObject({ kind: 'browser', current: true })
    expect((await errorOf(() => api.revokeAccountSession('another')))?.status).toBe(404)
    await api.revokeOtherAccountSessions()
    expect(await api.getSession()).not.toBeNull()
    await api.revokeAccountSession(only.id)
    expect(await api.getSession()).toBeNull()
    expect((await errorOf(() => api.getAccount()))?.code).toBe('unauthenticated')
  })
})
