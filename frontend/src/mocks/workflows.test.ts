import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import type { WorkflowInput } from '@/api/types'
import usersJson from './fixtures/users.json'
import { resetTables } from './engine'
import { createMockClient } from './mockClient'
import { listForms, resetSettings } from './settings'
import { breakChannel, resetSlack } from './slack'
import { resetWorkflows } from './workflows'

// テストケース表: docs/tests/workflows.md。1 つの it が表の 1 行(ID をラベルに入れる)。
// 本物の API の同じ行は backend/tests/test_workflows.py
const admin = usersJson.find((u) => u.admin)!
const member = usersJson.find((u) => !u.admin)!

type Api = ReturnType<typeof createMockClient>

async function errorOf(fn: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await fn()
    return null
  } catch (e) {
    if (e instanceof ApiError) return e
    throw e
  }
}

async function setup(): Promise<{ api: Api; channel: string }> {
  const api = createMockClient()
  await api.login(admin.email, 'x')
  const { url } = await api.slackConnect()
  return { api, channel: new URL(url, 'http://works.test').searchParams.get('channel')! }
}

const draft = (channel: string, patch: Partial<WorkflowInput> = {}): WorkflowInput => ({
  name: '新しい取引先責任者',
  enabled: true,
  object: 'contacts',
  trigger: { event: 'created', origins: ['app', 'form', 'mcp', 'auto'] },
  actions: [{ id: 'a1', type: 'slack', channel, fields: ['email', 'status'] }],
  ...patch,
})

describe('ワークフローの擬似(mocks/workflows.ts)', () => {
  beforeEach(() => {
    localStorage.clear()
    resetTables()
    resetSettings()
    resetSlack()
    resetWorkflows()
  })

  it('WF-001 createWorkflow → listWorkflows に出て、updateWorkflow で変わる。どこからは画面の並びに揃う', async () => {
    const { api, channel } = await setup()
    const created = await api.createWorkflow(draft(channel))
    expect(created).toMatchObject({ name: '新しい取引先責任者', object: 'contacts', enabled: true, created_by: admin.id, last_run: null, problems: [] })
    expect(created.actions).toEqual([{ id: 'a1', type: 'slack', channel, fields: ['email', 'status'] }])
    expect((await api.listWorkflows()).map((w) => w.id)).toEqual([created.id])

    const updated = await api.updateWorkflow(
      created.id,
      draft(channel, { name: '  有望な責任者  ', enabled: false, trigger: { event: 'matched', filter: { field: 'status', op: 'eq', value: 'active' }, origins: ['import', 'app'] } }),
    )
    expect(updated.name, '名前は前後の空白を落とす').toBe('有望な責任者')
    expect(updated.enabled).toBe(false)
    expect(updated.trigger).toEqual({ event: 'matched', filter: { field: 'status', op: 'eq', value: 'active' }, origins: ['app', 'import'] })
  })

  it('WF-002 管理者でない利用者は、ワークフローの読み書き・実行記録・テスト送信・送り直しが 403', async () => {
    const { api, channel } = await setup()
    const created = await api.createWorkflow(draft(channel))
    await api.logout()
    await api.login(member.email, 'x')
    const calls: [string, () => Promise<unknown>][] = [
      ['listWorkflows', () => api.listWorkflows()],
      ['createWorkflow', () => api.createWorkflow(draft(channel))],
      ['updateWorkflow', () => api.updateWorkflow(created.id, draft(channel))],
      ['deleteWorkflow', () => api.deleteWorkflow(created.id)],
      ['restoreWorkflow', () => api.restoreWorkflow(created.id)],
      ['listWorkflowRuns', () => api.listWorkflowRuns(created.id)],
      ['retryWorkflowRun', () => api.retryWorkflowRun('run')],
      ['testWorkflow', () => api.testWorkflow(draft(channel))],
    ]
    for (const [name, call] of calls) expect((await errorOf(call))?.status, name).toBe(403)
  })

  it('WF-003 形の不備(名前・テーブル・いつ・条件の無い matched・どこから・アクション・id の重複・チャンネル・載せる項目)は 400 で、何も作らない', async () => {
    const { api, channel } = await setup()
    const cases: [Partial<WorkflowInput>, string][] = [
      [{ name: '  ' }, '名前を入力'],
      [{ object: 'nothing' }, 'テーブルを選んで'],
      [{ trigger: { event: 'deleted' as 'created', origins: ['app'] } }, 'いつ動かすか'],
      [{ trigger: { event: 'matched', origins: ['app'] } }, '条件を 1 つ以上'],
      [{ trigger: { event: 'created', origins: [] } }, '1 つ以上選んで'],
      [{ trigger: { event: 'created', origins: ['email' as 'app'] } }, 'どこからの書き込み'],
      [{ actions: [] }, 'アクションを 1 つ以上'],
      [{ actions: [{ id: 'a1', type: 'email' as 'slack', channel, fields: [] }] }, '知らないアクション'],
      [{ actions: [{ id: 'a1', type: 'slack', channel, fields: [] }, { id: 'a1', type: 'slack', channel, fields: [] }] }, 'id が正しくありません'],
      [{ actions: [{ id: 'a1', type: 'slack', channel: null, fields: [] }] }, 'チャンネルを選んで'],
      [{ actions: [{ id: 'a1', type: 'slack', channel, fields: ['nothing'] }] }, '載せる項目'],
    ]
    for (const [patch, message] of cases) {
      const error = await errorOf(() => api.createWorkflow(draft(channel, patch)))
      expect(error?.status, message).toBe(400)
      expect(error?.message, message).toContain(message)
    }
    expect(await api.listWorkflows()).toEqual([])
  })

  it('WF-004 条件に「自分」($me)・無い項目・型に合わない値は 400', async () => {
    const { api, channel } = await setup()
    const cases: [WorkflowInput['trigger']['filter'], string][] = [
      [{ field: 'owner_id', op: 'eq', value: '$me' }, '「自分」は使えません'],
      [{ and: [{ field: 'status', op: 'eq', value: 'new' }, { field: 'nothing', op: 'eq', value: 1 }] }, '条件'],
      [{ field: 'last_contacted_on', op: 'lt', value: 'あした' }, '条件'],
    ]
    for (const [filter, message] of cases) {
      const error = await errorOf(() => api.createWorkflow(draft(channel, { trigger: { event: 'matched', filter, origins: ['app'] } })))
      expect(error?.status, message).toBe(400)
      expect(error?.message, message).toContain(message)
    }
  })

  it('WF-005 deleteWorkflow で一覧から消え、restoreWorkflow で戻る。実行記録は残る', async () => {
    const { api, channel } = await setup()
    const created = await api.createWorkflow(draft(channel))
    await api.createRecord('contacts', { name: '山田 太郎' })
    await api.deleteWorkflow(created.id)
    expect(await api.listWorkflows()).toEqual([])
    expect((await errorOf(() => api.listWorkflowRuns(created.id)))?.status, '削除中は実行記録も 404').toBe(404)
    const restored = await api.restoreWorkflow(created.id)
    expect(restored.last_run?.status).toBe('done')
    expect(await api.listWorkflowRuns(created.id)).toHaveLength(1)
    expect((await errorOf(() => api.restoreWorkflow(created.id)))?.status, '削除していないものは戻せない').toBe(404)
  })

  it('WF-010 作成されたときは作成でだけ動き、条件があれば満たすときだけ。更新では動かない', async () => {
    const { api, channel } = await setup()
    const every = await api.createWorkflow(draft(channel))
    const onlyNew = await api.createWorkflow(draft(channel, { name: '新規だけ', trigger: { event: 'created', filter: { field: 'status', op: 'eq', value: 'new' }, origins: ['app'] } }))
    const { record } = await api.createRecord('contacts', { name: '山田 太郎', status: 'active' })
    const runs = await api.listWorkflowRuns(every.id)
    expect(runs.map((r) => [r.status, r.event, r.origin, r.record_name, r.record_id, r.actor_id, r.target])).toEqual([['done', 'created', 'app', '山田 太郎', record.id, admin.id, '#web-問い合わせ']])
    expect(await api.listWorkflowRuns(onlyNew.id)).toEqual([])
    expect((await api.listWorkflows())[0].last_run?.status).toBe('done')

    await api.updateRecord('contacts', record.id, { status: 'new' })
    expect(await api.listWorkflowRuns(every.id), '更新では動かない').toHaveLength(1)
    expect(await api.listWorkflowRuns(onlyNew.id)).toEqual([])
    await api.createRecord('contacts', { name: '新しい人', status: 'new' })
    expect(await api.listWorkflowRuns(onlyNew.id)).toHaveLength(1)
  })

  it('WF-011 条件を満たしたときは、満たした瞬間に 1 回。満たしたままの更新では動かず、外れてからまた満たせばもう 1 回。作成時に満たせば作成で動く', async () => {
    const { api, channel } = await setup()
    const w = await api.createWorkflow(draft(channel, { name: '有望', trigger: { event: 'matched', filter: { field: 'status', op: 'eq', value: 'active' }, origins: ['app'] } }))
    const { record } = await api.createRecord('contacts', { name: '山田 太郎', status: 'new' })
    expect(await api.listWorkflowRuns(w.id)).toEqual([])
    await api.updateRecord('contacts', record.id, { status: 'active' })
    expect((await api.listWorkflowRuns(w.id)).map((r) => r.event)).toEqual(['matched'])
    await api.updateRecord('contacts', record.id, { title: '部長' })
    expect(await api.listWorkflowRuns(w.id), '満たしたままでは動かない').toHaveLength(1)
    await api.updateRecord('contacts', record.id, { status: 'dormant' })
    await api.updateRecord('contacts', record.id, { status: 'active' })
    expect(await api.listWorkflowRuns(w.id), '外れてからまた満たした').toHaveLength(2)
    await api.createRecord('contacts', { name: '田中 花子', status: 'active' })
    expect((await api.listWorkflowRuns(w.id))[0].record_name, '新しい順').toBe('田中 花子')
  })

  it('WF-012 どこからの書き込みで動くかを選べる。既定は CSV の取り込みで動かず、Web フォームは form、繰り返しの次回は auto', async () => {
    const { api, channel } = await setup()
    const onlyForms = await api.createWorkflow(draft(channel, { name: 'フォームだけ', trigger: { event: 'created', origins: ['form'] } }))
    const everything = await api.createWorkflow(draft(channel, { name: '既定' }))
    await api.createRecord('contacts', { name: '画面の人' })
    expect(await api.listWorkflowRuns(onlyForms.id)).toEqual([])
    expect(await api.listWorkflowRuns(everything.id)).toHaveLength(1)

    const form = listForms().find((f) => f.enabled && f.object === 'contacts')!
    await api.submitWebForm(form.key, { name: 'フォームの人' })
    expect((await api.listWorkflowRuns(onlyForms.id)).map((r) => [r.origin, r.actor_id])).toEqual([['form', null]])

    await api.importRecords('contacts', { csv: '氏名\nCSV の人\n' })
    expect(await api.listWorkflowRuns(everything.id), '既定は CSV で動かない').toHaveLength(2)

    const tasks = await api.createWorkflow({ ...draft(channel), name: '次回のタスク', object: 'tasks', trigger: { event: 'created', origins: ['auto'] }, actions: [{ id: 'a1', type: 'slack', channel, fields: ['due_date'] }] })
    const { record } = await api.createRecord('tasks', { title: '週報', due_date: '2026-10-01', repeat: 'weekly' })
    expect(await api.listWorkflowRuns(tasks.id)).toEqual([])
    await api.updateRecord('tasks', record.id, { status: 'done' })
    expect((await api.listWorkflowRuns(tasks.id)).map((r) => [r.origin, r.record_name])).toEqual([['auto', '週報']])
  })

  it('WF-013 オフと削除中のワークフローは動かない', async () => {
    const { api, channel } = await setup()
    const off = await api.createWorkflow(draft(channel, { name: 'オフ', enabled: false }))
    const removed = await api.createWorkflow(draft(channel, { name: '削除中' }))
    await api.deleteWorkflow(removed.id)
    await api.createRecord('contacts', { name: '山田 太郎' })
    expect(await api.listWorkflowRuns(off.id)).toEqual([])
    await api.restoreWorkflow(removed.id)
    expect(await api.listWorkflowRuns(removed.id)).toEqual([])
  })

  it('WF-017 失敗の実行は retryWorkflowRun でもう一度送れる。送ったものは 409', async () => {
    const { api, channel } = await setup()
    const w = await api.createWorkflow(draft(channel))
    breakChannel(channel)
    await api.createRecord('contacts', { name: '山田 太郎' })
    const [failed] = await api.listWorkflowRuns(w.id)
    expect(failed.status).toBe('failed')
    expect(failed.error).toContain('channel_not_found')
    expect((await api.listWorkflows())[0].problems[0], '要再接続が問題に出る').toContain('要再接続')

    await api.slackTest(channel)
    const retried = await api.retryWorkflowRun(failed.id)
    expect(retried.status, '繋ぎ直したあとは送れる').toBe('done')
    expect((await errorOf(() => api.retryWorkflowRun(failed.id)))?.status).toBe(409)
    expect((await errorOf(() => api.retryWorkflowRun('nothing')))?.status).toBe(404)
  })

  it('WF-019 条件が無い項目を指すワークフローは動かず、問題に出る', async () => {
    const { api, channel } = await setup()
    const w = await api.createWorkflow(draft(channel, { trigger: { event: 'created', filter: { field: 'status', op: 'eq', value: 'new' }, origins: ['app'] } }))
    // 項目を外す(テーブル設定の保存。列の値は残る)
    const meta = await api.getMeta()
    const contacts = meta.objects.find((o) => o.key === 'contacts')!
    await api.updateObject('contacts', {
      key: 'contacts',
      label: contacts.label,
      icon: contacts.icon,
      color: contacts.color,
      fields: contacts.fields.filter((f) => !f.readonly && f.key !== 'status'),
    })
    await api.createRecord('contacts', { name: '山田 太郎' })
    expect(await api.listWorkflowRuns(w.id)).toEqual([])
    expect((await api.listWorkflows())[0].problems[0]).toContain('status')
  })

  it('WF-020 testWorkflow は保存前の定義で、条件を満たす最新のレコードを使い、実行記録に残さない。レコードが無ければ見本', async () => {
    const { api, channel } = await setup()
    await api.createRecord('contacts', { name: '古い人' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await api.createRecord('contacts', { name: '新しい人' })
    const sent = await api.testWorkflow(draft(channel, { name: 'まだ保存していない' }))
    expect(sent.record?.name).toBe('新しい人')
    expect(sent.results).toEqual([{ action_id: 'a1', ok: true, error: null }])
    expect(await api.listWorkflows()).toEqual([])

    breakChannel(channel)
    const failed = await api.testWorkflow(draft(channel))
    expect(failed.results[0].ok).toBe(false)
    expect(failed.results[0].error).toContain('channel_not_found')

    await api.createObject({ key: 'leads', label: 'リード', icon: 'user-plus', color: 'teal', fields: [{ key: 'name', label: '氏名', type: 'text' }] })
    await api.slackTest(channel)
    expect((await api.testWorkflow(draft(channel, { object: 'leads', actions: [{ id: 'a1', type: 'slack', channel, fields: [] }] }))).record, 'レコードが無ければ見本').toBeNull()
  })
})
