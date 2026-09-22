import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import type { ObjectInput, ViewInput, WebFormInput } from '@/api/types'
import usersJson from './fixtures/users.json'
import { getMeta, resetTables } from './engine'
import { createMockClient } from './mockClient'
import { listForms, listTokens, resetSettings } from './settings'

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
    resetSettings()
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

  it('SET-003 管理者でない利用者の listMcpTokens / createMcpToken / listWebForms / createWebForm は 403 で、トークンとフォームは増えない', async () => {
    const api = createMockClient()
    await api.login(member.email, 'x')
    const object = getMeta().objects[0]
    const field = object.fields.find((f) => !f.readonly && f.type === 'text')!
    const form: WebFormInput = { name: '試しのフォーム', object: object.key, fields: [field.key], defaults: {}, enabled: true, redirect_url: null }
    const tokensBefore = listTokens()
    const formsBefore = listForms()

    expect(await statusOf(() => api.listMcpTokens()), 'listMcpTokens').toBe(403)
    expect(await statusOf(() => api.createMcpToken('試しのトークン', 'claude-code')), 'createMcpToken').toBe(403)
    expect(await statusOf(() => api.listWebForms()), 'listWebForms').toBe(403)
    expect(await statusOf(() => api.createWebForm(form)), 'createWebForm').toBe(403)
    expect(listTokens()).toEqual(tokensBefore)
    expect(listForms()).toEqual(formsBefore)

    // 対照: 管理者なら同じ呼び出しが通る(403 は管理者かどうかで決まっている)
    await api.logout()
    await api.login(admin.email, 'x')
    expect(await statusOf(() => api.listMcpTokens()), 'listMcpTokens(管理者)').toBeNull()
    expect(await statusOf(() => api.createMcpToken('試しのトークン', 'claude-code')), 'createMcpToken(管理者)').toBeNull()
    expect(await statusOf(() => api.listWebForms()), 'listWebForms(管理者)').toBeNull()
    expect(await statusOf(() => api.createWebForm(form)), 'createWebForm(管理者)').toBeNull()
  })

  it('SET-004 管理者でない利用者の createView / updateView / deleteView は通り、ビューが作られ・変わり・消える(ビューは誰でも。Q-045)', async () => {
    const api = createMockClient()
    await api.login(member.email, 'x')
    const object = getMeta().objects[0]
    const field = object.fields.find((f) => f.type === 'text')!
    const view: ViewInput = { name: '試しのビュー', type: 'list', config: { columns: [{ field: field.key }] } }
    const idsBefore = getMeta().views.map((v) => v.id)

    expect(await statusOf(() => api.createView(object.key, view)), 'createView').toBeNull()
    const created = getMeta().views.find((v) => !idsBefore.includes(v.id))
    expect(created, '作ったビューが定義に入る').toMatchObject({ object: object.key, name: '試しのビュー' })

    expect(await statusOf(() => api.updateView(created!.id, { ...view, name: '書き換えたビュー' })), 'updateView').toBeNull()
    expect(getMeta().views.find((v) => v.id === created!.id)?.name).toBe('書き換えたビュー')

    expect(await statusOf(() => api.deleteView(created!.id)), 'deleteView').toBeNull()
    expect(getMeta().views.map((v) => v.id)).toEqual(idsBefore)
  })

  it('SET-005 未ログインの getMeta / listRecords は 401 で、ログインすれば同じ呼び出しが通る', async () => {
    const api = createMockClient()
    const object = getMeta().objects[0]

    expect(await api.getSession(), 'セッションが無い').toBeNull()
    expect(await statusOf(() => api.getMeta()), 'getMeta').toBe(401)
    expect(await statusOf(() => api.listRecords(object.key)), 'listRecords').toBe(401)

    // 対照: ログインすれば同じ呼び出しが通る(401 はログインの有無で決まっている)
    await api.login(member.email, 'x')
    expect(await statusOf(() => api.getMeta()), 'getMeta(ログイン後)').toBeNull()
    expect(await statusOf(() => api.listRecords(object.key)), 'listRecords(ログイン後)').toBeNull()

    // ログアウトすれば再び 401
    await api.logout()
    expect(await statusOf(() => api.getMeta()), 'getMeta(ログアウト後)').toBe(401)
    expect(await statusOf(() => api.listRecords(object.key)), 'listRecords(ログアウト後)').toBe(401)
  })
})
