import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import type { ObjectInput } from '@/api/types'
import usersJson from './fixtures/users.json'
import { getMeta, resetTables } from './engine'
import { createMockClient } from './mockClient'

// テストケース表: docs/tests/settings.md。1 つの it が表の 1 行(ID をラベルに入れる)
const input = (key: string): ObjectInput => ({
  key,
  label: '試しのテーブル',
  icon: 'box',
  color: 'blue',
  fields: [{ key: 'name', label: '名前', type: 'text' }],
})

/** 呼んだ結果の ApiError の status(投げなければ null) */
async function statusOf(fn: () => Promise<unknown>): Promise<number | null> {
  try {
    await fn()
    return null
  } catch (e) {
    if (e instanceof ApiError) return e.status
    throw e
  }
}

const admin = usersJson.find((u) => u.admin)!
const member = usersJson.find((u) => !u.admin)!

describe('環境設定の権限(mocks/mockClient.ts)', () => {
  beforeEach(() => {
    localStorage.clear()
    resetTables()
  })

  it('SET-002 管理者でない利用者の createObject / updateObject / deleteObject / reorderObjects は 403 で、テーブルの定義は変わらない', async () => {
    const api = createMockClient()
    await api.login(member.email, 'x')
    const before = getMeta().objects
    const first = before[0]
    const keys = before.map((o) => o.key)

    expect(await statusOf(() => api.createObject(input('set_trial'))), 'createObject').toBe(403)
    expect(await statusOf(() => api.updateObject(first.key, { ...input(first.key), label: '書き換え' })), 'updateObject').toBe(403)
    expect(await statusOf(() => api.deleteObject(first.key)), 'deleteObject').toBe(403)
    expect(await statusOf(() => api.reorderObjects([...keys].reverse())), 'reorderObjects').toBe(403)
    expect(getMeta().objects).toEqual(before)

    // 対照: 管理者なら同じ呼び出しが通る(403 は管理者かどうかで決まっている)
    await api.logout()
    await api.login(admin.email, 'x')
    expect(await statusOf(() => api.createObject(input('set_trial'))), 'createObject(管理者)').toBeNull()
    expect(await statusOf(() => api.reorderObjects(getMeta().objects.map((o) => o.key).reverse())), 'reorderObjects(管理者)').toBeNull()
  })
})
