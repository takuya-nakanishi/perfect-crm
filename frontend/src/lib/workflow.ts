/**
 * ワークフロー(04 §15)の画面側の決まり。モック(mocks/workflows.ts)と画面が共有する純粋な関数だけを置く。
 * 判定と検証の正はサーバ(いまはモックの `checkWorkflow` と、書き込みの口に差し込んだ判定)
 */
import type { Filter, MetaResponse, ObjectMeta, SlackAction, TagColor, Workflow, WorkflowInput, WorkflowOrigin, WorkflowRunStatus, WorkflowTrigger } from '@/api/types'

/** どこからの書き込みか。この順で並べる(本番の `ORIGIN_KINDS` と同じ) */
export const ORIGIN_ORDER: WorkflowOrigin[] = ['app', 'form', 'mcp', 'auto', 'import']

export const ORIGINS: Record<WorkflowOrigin, { label: string; hint: string }> = {
  app: { label: '画面', hint: 'Works の画面から作る・直す' },
  form: { label: 'Web フォーム', hint: 'Web サイトからの登録' },
  mcp: { label: 'AI(MCP)', hint: 'Claude などの AI アプリから' },
  auto: { label: '自動作成', hint: '繰り返しのタスクの次回' },
  import: { label: 'CSV の取り込み', hint: '取り込んだ件数だけ動きます' },
}

/** 新しいワークフローの「どこから」。CSV の取り込みは入れない(100 件入れると 100 通届く) */
export const DEFAULT_ORIGINS: WorkflowOrigin[] = ['app', 'form', 'mcp', 'auto']

export const EVENTS: { value: WorkflowTrigger['event']; label: string; hint: string }[] = [
  { value: 'created', label: '作成されたとき', hint: '新しいレコードができたら。条件を入れると、それを満たすものだけ' },
  { value: 'matched', label: '条件を満たしたとき', hint: '作成・更新で、条件を満たした瞬間に 1 回。満たしたまま直しても、もう一度は動かない' },
]

/** アクションの種類。足すときは、本番の `app/workflows/actions/` とモックの `checkWorkflow` にも足す */
export const ACTION_KINDS: { type: SlackAction['type']; label: string; hint: string }[] = [
  { type: 'slack', label: 'Slack に知らせる', hint: '選んだチャンネルへ、レコードの名前と選んだ項目を送ります' },
]

/** 実行記録の状態。いまのアクションは Slack だけなので「送信」と呼ぶ */
export const RUN_STATUS: Record<WorkflowRunStatus, { label: string; color: TagColor }> = {
  queued: { label: '送信待ち', color: 'gray' },
  running: { label: '送信中', color: 'blue' },
  done: { label: '送信済み', color: 'green' },
  failed: { label: '失敗', color: 'red' },
  skipped: { label: '見送り', color: 'amber' },
}

/** 条件が指している列名(入れ子もたどる) */
export function filterFields(filter: Filter | undefined): string[] {
  if (!filter) return []
  if ('and' in filter) return filter.and.flatMap(filterFields)
  if ('or' in filter) return filter.or.flatMap(filterFields)
  return [filter.field]
}

/** ワークフローの中でアクションを見分ける名前 */
export function newActionId(): string {
  return `a${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`
}

/** 「Slack に知らせる」に初めから載せる項目: そのテーブルの最初の一覧の列(表示名は見出しに出るので除く)。6 つまで */
export function defaultSlackFields(meta: MetaResponse, object: ObjectMeta): string[] {
  const view = meta.views.filter((v) => v.object === object.key && v.type === 'list').sort((a, b) => a.position - b.position)[0]
  const known = new Set(object.fields.filter((f) => !f.readonly).map((f) => f.key))
  const columns = view?.type === 'list' ? view.config.columns.map((c) => c.field) : object.fields.map((f) => f.key)
  return columns.filter((k) => k !== object.name_field && known.has(k)).slice(0, 6)
}

export function newSlackAction(meta: MetaResponse, object: ObjectMeta, channel: string | null): SlackAction {
  return { id: newActionId(), type: 'slack', channel, fields: defaultSlackFields(meta, object) }
}

/** 新しいワークフローの下書き。テーブルを選べば、そのテーブルの既定の項目が入る */
export function newWorkflowDraft(meta: MetaResponse, object: ObjectMeta, channel: string | null): WorkflowInput {
  return {
    name: '',
    enabled: true,
    object: object.key,
    trigger: { event: 'created', origins: [...DEFAULT_ORIGINS] },
    actions: [newSlackAction(meta, object, channel)],
  }
}

export function toWorkflowInput(w: Workflow): WorkflowInput {
  return structuredClone({ name: w.name, enabled: w.enabled, object: w.object, trigger: w.trigger, actions: w.actions })
}

/** 「取引先責任者が作成されたとき」「商談が条件を満たしたとき」 */
export function describeTrigger(object: ObjectMeta | undefined, trigger: WorkflowTrigger): string {
  const label = object?.label ?? 'テーブル'
  return trigger.event === 'created' ? `${label}が作成されたとき` : `${label}が条件を満たしたとき`
}

/** 既定と違うときだけ「Web フォームから」「画面・AI(MCP)から」。既定なら null */
export function describeOrigins(origins: WorkflowOrigin[]): string | null {
  const same = origins.length === DEFAULT_ORIGINS.length && DEFAULT_ORIGINS.every((o) => origins.includes(o))
  if (same) return null
  return `${ORIGIN_ORDER.filter((o) => origins.includes(o)).map((o) => ORIGINS[o].label).join('・')}から`
}

export interface DraftIssues {
  name?: string
  filter?: string
  origins?: string
  /** アクションの id → 直すこと */
  actions: Record<string, string>
  count: number
}

/**
 * 保存する前に画面で分かる不備(名前・条件・どこから・チャンネル)。サーバも同じことを確かめる(正はサーバ)。
 * 画面は、保存を押したときにだけ出す
 */
export function draftIssues(input: WorkflowInput): DraftIssues {
  const issues: DraftIssues = { actions: {}, count: 0 }
  if (!input.name.trim()) issues.name = 'ワークフローの名前を入力してください'
  if (input.trigger.event === 'matched' && filterFields(input.trigger.filter).length === 0) issues.filter = '「条件を満たしたとき」には、条件を 1 つ以上入れてください'
  if (input.trigger.origins.length === 0) issues.origins = 'どこからの書き込みで動かすかを 1 つ以上選んでください'
  for (const action of input.actions) if (action.type === 'slack' && !action.channel) issues.actions[action.id] = '送り先のチャンネルを選んでください'
  issues.count = [issues.name, issues.filter, issues.origins].filter(Boolean).length + Object.keys(issues.actions).length
  return issues
}
