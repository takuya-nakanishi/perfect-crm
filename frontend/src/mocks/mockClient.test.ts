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

  it('SET-021 createMcpToken の secret は wks_ + 40 文字、token.prefix はその先頭 8 文字で、一覧には secret が入らない', async () => {
    const api = createMockClient()
    await api.login(admin.email, 'x')

    const { token, secret } = await api.createMcpToken('試しのトークン', 'claude-code')
    expect(secret).toMatch(/^wks_[a-z0-9]{40}$/)
    expect(token.prefix).toBe(secret.slice(0, 8))

    const listed = (await api.listMcpTokens()).find((t) => t.id === token.id)
    expect(listed, '発行したトークンが一覧に入る').toMatchObject({ prefix: token.prefix })
    expect(listed).not.toHaveProperty('secret')
    expect(JSON.stringify(await api.listMcpTokens()), '一覧のどこにも全文が無い').not.toContain(secret)
  })

  it('SET-022 createMcpToken の名前が空なら 400 でトークンは増えず、revokeMcpToken で一覧から消え、無い id なら 404', async () => {
    const api = createMockClient()
    await api.login(admin.email, 'x')
    const before = listTokens()

    expect(await statusOf(() => api.createMcpToken('', 'claude-code')), '名前が空').toBe(400)
    expect(await statusOf(() => api.createMcpToken('   ', 'claude-code')), '名前が空白だけ').toBe(400)
    expect(listTokens(), '失敗した発行でトークンは増えない').toEqual(before)

    const { token } = await api.createMcpToken('消すトークン', 'claude-code')
    expect((await api.listMcpTokens()).map((t) => t.id)).toContain(token.id)

    await api.revokeMcpToken(token.id)
    expect((await api.listMcpTokens()).map((t) => t.id), '失効したトークンは一覧から消える').not.toContain(token.id)

    expect(await statusOf(() => api.revokeMcpToken(token.id)), '失効済みの id').toBe(404)
    expect(await statusOf(() => api.revokeMcpToken(crypto.randomUUID())), '無い id').toBe(404)
    expect(listTokens(), '404 のあとも一覧は変わらない').toEqual(before)
  })

  it('SET-023 createMcpToken の created_by は発行した自分の id、last_used_at は null(一覧でも同じ)', async () => {
    const api = createMockClient()
    const others = usersJson.filter((u) => u.admin).slice(0, 2)
    for (const me of others.length > 1 ? others : [admin]) {
      await api.login(me.email, 'x')
      const { token } = await api.createMcpToken(`${me.id} のトークン`, 'codex')
      expect(token.created_by, '発行した利用者').toBe(me.id)
      expect(token.last_used_at, 'まだ使っていない').toBeNull()

      const listed = (await api.listMcpTokens()).find((t) => t.id === token.id)
      expect(listed, '一覧でも同じ').toMatchObject({ created_by: me.id, last_used_at: null })
      await api.logout()
    }
  })

  it('SET-042 createWebForm は 名前が空 / テーブルが無い / 項目が 0 / readonly・関連先・ドライブの項目 / redirect_url が http(s) でない ならそれぞれ 400 で、フォームは増えない', async () => {
    const api = createMockClient()
    await api.login(admin.email, 'x')
    const objects = getMeta().objects
    const object = objects[0]
    const field = object.fields.find((f) => !f.readonly && f.type === 'text')!
    const ok: WebFormInput = { name: '試しのフォーム', object: object.key, fields: [field.key], defaults: {}, enabled: true, redirect_url: null }
    // 受け付けられない項目は、それを持つテーブルをメタデータから探す
    const withField = (pick: (f: (typeof object.fields)[number]) => boolean) => {
      const o = objects.find((x) => x.fields.some(pick))!
      const text = o.fields.find((f) => !f.readonly && f.type === 'text')!
      return { ...ok, object: o.key, fields: [text.key, o.fields.find(pick)!.key] }
    }
    const before = listForms()

    expect(await statusOf(() => api.createWebForm({ ...ok, name: '' })), '名前が空').toBe(400)
    expect(await statusOf(() => api.createWebForm({ ...ok, name: '   ' })), '名前が空白だけ').toBe(400)
    expect(await statusOf(() => api.createWebForm({ ...ok, object: 'no_such_table' })), 'テーブルが無い').toBe(400)
    expect(await statusOf(() => api.createWebForm({ ...ok, fields: [] })), '項目が 0').toBe(400)
    expect(await statusOf(() => api.createWebForm(withField((f) => !!f.readonly))), 'readonly の項目').toBe(400)
    expect(await statusOf(() => api.createWebForm(withField((f) => f.type === 'polymorphic'))), '関連先の項目').toBe(400)
    expect(await statusOf(() => api.createWebForm(withField((f) => f.type === 'drive_files'))), 'ドライブの項目').toBe(400)
    expect(await statusOf(() => api.createWebForm({ ...ok, redirect_url: 'ftp://example.com/thanks' })), 'redirect_url が ftp').toBe(400)
    expect(await statusOf(() => api.createWebForm({ ...ok, redirect_url: 'javascript:alert(1)' })), 'redirect_url が javascript:').toBe(400)
    expect(listForms(), '失敗した作成でフォームは増えない').toEqual(before)

    // 対照: 正しい入力なら通る(400 は各欄の中身で決まっている)
    expect(await statusOf(() => api.createWebForm(ok)), '正しい入力').toBeNull()
    expect(await statusOf(() => api.createWebForm({ ...ok, redirect_url: 'https://example.com/thanks' })), 'redirect_url が https').toBeNull()
    expect(await statusOf(() => api.createWebForm({ ...ok, redirect_url: 'http://example.com/thanks' })), 'redirect_url が http').toBeNull()
    expect(listForms()).toHaveLength(before.length + 3)
  })

  it('SET-043 submitWebForm は fields に無い列を捨て、defaults を足してレコードを作り、フォームの submissions が増えて last_submitted_at が入る', async () => {
    const api = createMockClient()
    await api.login(admin.email, 'x')
    // 必須が文字の項目だけで、ほかに文字の項目を 3 つ持つテーブルをメタデータから探す
    const plain = (f: ReturnType<typeof getMeta>['objects'][number]['fields'][number]) => f.type === 'text' && !f.readonly
    const object = getMeta().objects.find((o) => o.fields.filter((f) => f.required).every(plain) && o.fields.filter((f) => plain(f) && !f.required).length >= 3)!
    const required = object.fields.filter((f) => f.required)
    const [accepted, dropped, defaulted] = object.fields.filter((f) => plain(f) && !f.required)
    const form = await api.createWebForm({
      name: '試しのフォーム',
      object: object.key,
      fields: [...required.map((f) => f.key), accepted.key],
      defaults: { [defaulted.key]: '既定の値' },
      enabled: true,
      redirect_url: null,
    })
    expect(form.submissions).toBe(0)
    expect(form.last_submitted_at).toBeNull()
    // 受け口は認証なしで呼ばれる
    await api.logout()

    const values = { ...Object.fromEntries(required.map((f) => [f.key, `送信の${f.label}`])), [accepted.key]: '受ける値', [dropped.key]: '捨てる値', no_such_column: '捨てる値' }
    const startedAt = new Date().toISOString()
    const { record } = await api.submitWebForm(form.key, values)
    const finishedAt = new Date().toISOString()

    for (const f of required) expect(record[f.key], f.key).toBe(`送信の${f.label}`)
    expect(record[accepted.key], 'fields にある列は入る').toBe('受ける値')
    expect(record[dropped.key] ?? null, 'fields に無い列は捨てる').toBeNull()
    expect(record, 'テーブルに無い列も入らない').not.toHaveProperty('no_such_column')
    expect(record[defaulted.key], 'defaults が足される').toBe('既定の値')

    await api.login(admin.email, 'x')
    const stored = await api.getRecord(object.key, record.id as string)
    expect(stored.record, 'レコードができている').toMatchObject({ [accepted.key]: '受ける値', [defaulted.key]: '既定の値' })
    const after = (await api.listWebForms()).find((f) => f.id === form.id)!
    expect(after.submissions, '送信の数が増える').toBe(1)
    expect(after.last_submitted_at, '最後の送信の時刻が入る').not.toBeNull()
    expect(after.last_submitted_at! >= startedAt && after.last_submitted_at! <= finishedAt, '送信した時刻').toBe(true)
  })

  it('SET-044 submitWebForm は form-urlencoded の文字(数値・日付・選択肢のラベル)を項目の型に直してから作り、直せなければ 400 でレコードも送信の数も増えない', async () => {
    const api = createMockClient()
    await api.login(admin.email, 'x')
    // 数値・日付・選択肢を持つテーブルを作る(既存のテーブル名に頼らない)
    await api.createObject({
      ...input('set_form_types'),
      fields: [
        { key: 'name', label: '名前', type: 'text' },
        { key: 'amount', label: '金額', type: 'currency' },
        { key: 'due', label: '期日', type: 'date' },
        { key: 'rank', label: '見込み', type: 'select', options: [{ value: 'hot', label: '高い', color: 'red' }, { value: 'cold', label: '低い', color: 'blue' }] },
      ],
    })
    const form = await api.createWebForm({ name: '型のフォーム', object: 'set_form_types', fields: ['name', 'amount', 'due', 'rank'], defaults: {}, enabled: true, redirect_url: null })
    await api.logout()

    // form-urlencoded は全部が文字で届く
    const { record } = await api.submitWebForm(form.key, { name: '送信', amount: '1200000', due: '2026/9/30', rank: '高い' })
    expect(record.amount, '数値の文字は数値に').toBe(1200000)
    expect(record.due, '日付は YYYY-MM-DD に').toBe('2026-09-30')
    expect(record.rank, '選択肢はラベルから値に').toBe('hot')

    // 直せない文字は 400。レコードは作られない
    for (const [key, raw] of [['amount', '百万'], ['due', '9月30日'], ['rank', '普通']] as const) {
      expect(await statusOf(() => api.submitWebForm(form.key, { name: `直せない${key}`, [key]: raw })), `${key}「${raw}」`).toBe(400)
    }

    await api.login(admin.email, 'x')
    const stored = await api.getRecord('set_form_types', record.id as string)
    expect(stored.record, '直した値で保存される').toMatchObject({ amount: 1200000, due: '2026-09-30', rank: 'hot' })
    const { records } = await api.listRecords('set_form_types')
    expect(records.map((r) => r.name), '400 のときはレコードができない').toEqual(['送信'])
    expect((await api.listWebForms()).find((f) => f.id === form.id)!.submissions, '400 は送信に数えない').toBe(1)
  })

  it('SET-004管理者でない利用者の createView / updateView / deleteView は通り、ビューが作られ・変わり・消える(ビューは誰でも。Q-045)', async () => {
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
