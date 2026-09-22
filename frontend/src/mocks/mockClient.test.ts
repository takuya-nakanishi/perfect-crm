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

  it('SET-045 submitWebForm は止めたフォーム・無い鍵・削除中のテーブルを先に持つフォームなら 404 で、レコードも送信の数も増えない', async () => {
    const api = createMockClient()
    await api.login(admin.email, 'x')
    await api.createObject(input('set_form_gate'))
    const formInput: WebFormInput = { name: '関門のフォーム', object: 'set_form_gate', fields: ['name'], defaults: {}, enabled: true, redirect_url: null }
    const form = await api.createWebForm(formInput)
    const submit = (key: string, name: string) => statusOf(() => api.submitWebForm(key, { name }))

    // 対照: 受け付けている間は通る(404 は下の条件で決まっている)
    expect(await submit(form.key, '通る 1'), '受け付け中').toBeNull()

    // 止めたフォーム
    await api.updateWebForm(form.id, { ...formInput, enabled: false })
    expect(await submit(form.key, '止めた'), 'enabled: false').toBe(404)
    await api.updateWebForm(form.id, { ...formInput, enabled: true })
    expect(await submit(form.key, '通る 2'), '受け付けに戻す').toBeNull()

    // 無い鍵(作り直す前の鍵も含む)
    expect(await submit('no-such-key', '無い鍵'), '無い鍵').toBe(404)
    const rotated = await api.rotateWebFormKey(form.id)
    expect(await submit(form.key, '古い鍵'), '作り直す前の鍵').toBe(404)
    expect(await submit(rotated.key, '通る 3'), '新しい鍵').toBeNull()

    // 先のテーブルが削除中
    await api.deleteObject('set_form_gate')
    expect(await submit(rotated.key, '削除中'), '先のテーブルが削除中').toBe(404)
    await api.restoreObject('set_form_gate')
    expect(await submit(rotated.key, '通る 4'), 'テーブルを戻す').toBeNull()

    const { records } = await api.listRecords('set_form_gate')
    expect(records.map((r) => r.name).sort(), '404 のときはレコードができない').toEqual(['通る 1', '通る 2', '通る 3', '通る 4'])
    expect((await api.listWebForms()).find((f) => f.id === form.id)!.submissions, '404 は送信に数えない').toBe(4)
  })

  it('SET-046 submitWebForm は _gotcha が埋まっていたら例外を投げずに id だけの空の応答を返し、レコードも送信の数も増えない。_gotcha が空なら通る', async () => {
    const api = createMockClient()
    await api.login(admin.email, 'x')
    await api.createObject(input('set_form_gotcha'))
    const form = await api.createWebForm({ name: 'bot 避けのフォーム', object: 'set_form_gotcha', fields: ['name'], defaults: {}, enabled: true, redirect_url: null })
    await api.logout()

    // bot: 人には見えない欄が埋まっている → 成功に見せて何もしない(04 §10 の 3)
    expect(await statusOf(() => api.submitWebForm(form.key, { name: 'bot の送信', _gotcha: 'http://spam.example' })), '例外を投げない').toBeNull()
    const { record, references } = await api.submitWebForm(form.key, { name: 'bot の送信 2', _gotcha: 'x' })
    expect(Object.keys(record).sort(), '応答は id だけの空').toEqual(['created_at', 'id', 'updated_at'])
    expect(typeof record.id, 'id はある').toBe('string')
    expect(references).toEqual({})

    // 対照: _gotcha が空なら通る
    const { record: human } = await api.submitWebForm(form.key, { name: '人の送信', _gotcha: '' })
    expect(human.name, '空の _gotcha は通る').toBe('人の送信')

    await api.login(admin.email, 'x')
    expect(await statusOf(() => api.getRecord('set_form_gotcha', record.id as string)), '空の応答の id のレコードは無い').toBe(404)
    const { records } = await api.listRecords('set_form_gotcha')
    expect(records.map((r) => r.name), 'bot の送信ではレコードができない').toEqual(['人の送信'])
    expect((await api.listWebForms()).find((f) => f.id === form.id)!.submissions, 'bot の送信は数えない').toBe(1)
  })

  it('SET-047 rotateWebFormKey は鍵だけを作り直し、古い鍵で送ると 404 でレコードも送信の数も増えず、新しい鍵なら通る', async () => {
    const api = createMockClient()
    await api.login(admin.email, 'x')
    await api.createObject(input('set_form_rotate'))
    const form = await api.createWebForm({ name: '鍵のフォーム', object: 'set_form_rotate', fields: ['name'], defaults: {}, enabled: true, redirect_url: null })
    const submit = (key: string, name: string) => statusOf(() => api.submitWebForm(key, { name }))

    // 対照: 作り直す前は今の鍵で通る
    expect(await submit(form.key, '通る 1'), '作り直す前').toBeNull()

    const rotated = await api.rotateWebFormKey(form.id)
    expect(rotated.key, '鍵が変わる').not.toBe(form.key)
    expect(rotated, '鍵のほかは同じフォーム').toMatchObject({ ...form, key: rotated.key, submissions: 1, last_submitted_at: expect.any(String) })
    expect((await api.listWebForms()).find((f) => f.id === form.id)!.key, '一覧も新しい鍵').toBe(rotated.key)

    expect(await submit(form.key, '古い鍵'), '古い鍵').toBe(404)
    expect(await submit(rotated.key, '通る 2'), '新しい鍵').toBeNull()

    // もう一度作り直すと、1 つ前の鍵も効かなくなる
    const again = await api.rotateWebFormKey(form.id)
    expect(again.key).not.toBe(rotated.key)
    expect(again.key).not.toBe(form.key)
    expect(await submit(rotated.key, '1 つ前の鍵'), '1 つ前の鍵').toBe(404)
    expect(await submit(form.key, '最初の鍵'), '最初の鍵').toBe(404)
    expect(await submit(again.key, '通る 3'), '今の鍵').toBeNull()

    const { records } = await api.listRecords('set_form_rotate')
    expect(records.map((r) => r.name).sort(), '404 のときはレコードができない').toEqual(['通る 1', '通る 2', '通る 3'])
    expect((await api.listWebForms()).find((f) => f.id === form.id)!.submissions, '404 は送信に数えない').toBe(3)
  })

  it('SET-048 submitWebForm で作ったレコードの担当(user 型)は空で、ログイン中に送っても送った人にならず、defaults に入れた人なら担当になる', async () => {
    const api = createMockClient()
    await api.login(admin.email, 'x')
    await api.createObject({
      ...input('set_form_owner'),
      fields: [
        { key: 'name', label: '名前', type: 'text' },
        { key: 'owner', label: '担当', type: 'user' },
      ],
    })
    const plain = await api.createWebForm({ name: '担当なしのフォーム', object: 'set_form_owner', fields: ['name'], defaults: {}, enabled: true, redirect_url: null })
    const assigned = await api.createWebForm({ name: '担当ありのフォーム', object: 'set_form_owner', fields: ['name'], defaults: { owner: member.id }, enabled: true, redirect_url: null })

    // 対照: 画面から作れば担当は自分(担当が空なのは受け口だからで、テーブルの作りのせいではない)
    const byScreen = await api.createRecord('set_form_owner', { name: '画面から' })
    expect(byScreen.record.owner, '画面からの作成は自分が担当').toBe(admin.id)

    // ログインしたままでも、受け口は認証なしなので送った人は担当にならない
    const whileLoggedIn = await api.submitWebForm(plain.key, { name: 'ログイン中に送信' })
    expect(whileLoggedIn.record.owner ?? null, 'ログイン中に送っても担当は空').toBeNull()

    await api.logout()
    const anonymous = await api.submitWebForm(plain.key, { name: '送信' })
    expect(anonymous.record.owner ?? null, '担当は空').toBeNull()
    const withDefault = await api.submitWebForm(assigned.key, { name: '既定の担当' })
    expect(withDefault.record.owner, 'defaults に入れた人が担当').toBe(member.id)

    // 保存された行でも同じ
    await api.login(admin.email, 'x')
    const { records } = await api.listRecords('set_form_owner')
    const ownerOf = Object.fromEntries(records.map((r) => [r.name as string, r.owner ?? null]))
    expect(ownerOf).toEqual({ 画面から: admin.id, ログイン中に送信: null, 送信: null, 既定の担当: member.id })
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
