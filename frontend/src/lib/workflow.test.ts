import { describe, expect, it } from 'vitest'
import type { MetaResponse, WorkflowInput } from '@/api/types'
import { getMeta } from '@/mocks/engine'
import { DEFAULT_ORIGINS, defaultSlackFields, describeOrigins, describeTrigger, draftIssues, filterFields, newWorkflowDraft } from './workflow'

// テストケース表: docs/tests/workflows.md §5。1 つの it が表の 1 行
const meta: MetaResponse = getMeta()
const contacts = meta.objects.find((o) => o.key === 'contacts')!

describe('ワークフローの画面の決まり(lib/workflow.ts)', () => {
  it('WF-040 describeTrigger は「取引先責任者が作成されたとき」「取引先責任者が条件を満たしたとき」。describeOrigins は既定なら null、違えば並びどおりに「〜から」', () => {
    expect(describeTrigger(contacts, { event: 'created', origins: DEFAULT_ORIGINS })).toBe('取引先責任者が作成されたとき')
    expect(describeTrigger(contacts, { event: 'matched', origins: DEFAULT_ORIGINS })).toBe('取引先責任者が条件を満たしたとき')
    expect(describeOrigins(['auto', 'mcp', 'form', 'app'])).toBeNull()
    expect(describeOrigins(['form'])).toBe('Web フォームから')
    expect(describeOrigins(['import', 'app'])).toBe('画面・CSV の取り込みから')
  })

  it('WF-041 新しい下書きは「作成されたとき」、どこからは既定(CSV の取り込みを除く)、載せる項目は最初の一覧の列から表示名を除いた 6 つまで', () => {
    const draft = newWorkflowDraft(meta, contacts, 'ch-1')
    expect(draft.trigger).toEqual({ event: 'created', origins: ['app', 'form', 'mcp', 'auto'] })
    expect(draft.actions).toHaveLength(1)
    expect(draft.actions[0]).toMatchObject({ type: 'slack', channel: 'ch-1' })
    const fields = defaultSlackFields(meta, contacts)
    expect(draft.actions[0].fields).toEqual(fields)
    expect(fields).not.toContain(contacts.name_field)
    expect(fields.length).toBeGreaterThan(0)
    expect(fields.length).toBeLessThanOrEqual(6)
    for (const key of fields) expect(contacts.fields.some((f) => f.key === key && !f.readonly), key).toBe(true)
  })

  it('WF-042 draftIssues は、名前・条件の無い matched・どこからが空・チャンネル未選択を数え、揃っていれば 0。filterFields は入れ子の条件の列名を全部返す', () => {
    const ok: WorkflowInput = newWorkflowDraft(meta, contacts, 'ch-1')
    ok.name = '新しい責任者'
    expect(draftIssues(ok).count).toBe(0)

    const bad: WorkflowInput = { ...ok, name: ' ', trigger: { event: 'matched', origins: [] }, actions: [{ ...ok.actions[0], channel: null }] }
    const issues = draftIssues(bad)
    expect(issues.count).toBe(4)
    expect(issues.name).toBeTruthy()
    expect(issues.filter).toBeTruthy()
    expect(issues.origins).toBeTruthy()
    expect(issues.actions[ok.actions[0].id]).toBeTruthy()

    expect(filterFields({ or: [{ field: 'status', op: 'eq', value: 'new' }, { and: [{ field: 'role', op: 'is_empty' }] }] })).toEqual(['status', 'role'])
    expect(filterFields(undefined)).toEqual([])
  })
})
