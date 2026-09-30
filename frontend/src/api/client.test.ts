import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '@/mocks/engine'
import { api, SESSION_EXPIRED } from './client'

// テストケース表: docs/tests/auth.md
describe('セッションが切れたときの合図(api/client.ts)', () => {
  let fired = 0
  const count = () => {
    fired += 1
  }
  beforeEach(() => {
    localStorage.clear()
    resetTables()
    fired = 0
    window.addEventListener(SESSION_EXPIRED, count)
  })
  afterEach(() => window.removeEventListener(SESSION_EXPIRED, count))

  it('AUTH-026 使っている途中の 401(unauthenticated)で合図を出す。ログインの手順の口では出さない', async () => {
    await expect(api.getMeta()).rejects.toMatchObject({ status: 401, code: 'unauthenticated' })
    expect(fired).toBe(1)
    expect(await api.getSession()).toBeNull()
    await expect(api.verifyTotp('123456')).rejects.toMatchObject({ status: 401 })
    expect(fired).toBe(1)
    await api.login('takuya@example.jp', 'x')
    await api.getMeta()
    expect(fired).toBe(1)
  })
})
