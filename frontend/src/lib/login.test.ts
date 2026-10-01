import { describe, expect, it } from 'vitest'
import { enabledProviders, linkedProvider, providerError, providerLoginUrl, safeNext } from './login'

// テストケース表: docs/tests/auth.md §6。1 つの it が表の 1 行(ID をラベルに入れる)

describe('Google・Microsoft でログイン(lib/login.ts)', () => {
  it('AUTH-081 戻りの理由の符号を帯の文にし、知らない符号は出さない', () => {
    expect(providerError('google_not_registered')).toBe('この Google アカウントは Works に登録されていません')
    // Microsoft は、アドレスで探せないことがあるので、結ぶ道を添える
    expect(providerError('microsoft_not_registered')).toContain('アカウントの画面で結んで')
    expect(providerError('google_denied')).toBe('Google でのログインを取りやめました')
    expect(providerError('microsoft_failed')).toBe('Microsoft でのログインに失敗しました。もう一度お試しください')
    expect(providerError('google_not_configured')).toBe('Google でのログインは、まだ設定されていません')
    expect(providerError('microsoft_busy')).toBe('続けて試されたため、少し待ってからもう一度お試しください')
    expect(providerError('google_in_use')).toBe('この Google アカウントは、ほかの人に結ばれています')
    for (const unknown of [null, undefined, '', 'google_', 'yahoo_failed', 'google_whatever', '<script>']) {
      expect(providerError(unknown)).toBeNull()
    }
    expect(linkedProvider('microsoft')).toBe('microsoft')
    expect(linkedProvider('yahoo')).toBeNull()
  })

  it('AUTH-082 戻り先はアプリ内のパスだけ。ボタンは設定のある提供元だけで、行き先は戻り先を持つ', () => {
    expect(safeNext('/o/tasks?view=x')).toBe('/o/tasks?view=x')
    for (const outside of [null, '', 'o/tasks', 'https://evil.example/', '//evil.example/', '/\\evil.example', '/a\nb']) {
      expect(safeNext(outside)).toBe('/')
    }
    expect(providerLoginUrl('google', '/o/deals?view=1')).toBe('/api/v1/session/google?next=%2Fo%2Fdeals%3Fview%3D1')
    expect(providerLoginUrl('microsoft', '//evil.example')).toBe('/api/v1/session/microsoft?next=%2F')
    expect(enabledProviders({ google: true, microsoft: true })).toEqual(['google', 'microsoft'])
    expect(enabledProviders({ google: false, microsoft: true })).toEqual(['microsoft'])
    expect(enabledProviders(undefined)).toEqual([])
  })
})
