/**
 * ワークフローの擬似(04 §15)。本番はバックエンドの `workflows` / `workflow_runs` と送り係(`app/workflows/`)。
 *
 * レコードの書き込みの口(engine の `setWriteHooks`)に差し込み、作成・更新のたびに動かすワークフローを決める:
 * - 作成されたとき(created): 作成で、条件(あれば)を満たせば
 * - 条件を満たしたとき(matched): 作成・更新で、満たしていなかったものが満たした瞬間に 1 回
 * - 「どこから」(画面・Web フォーム・AI・自動作成・CSV)に入っていない書き込みでは動かない
 * - 条件が無い項目を指していれば動かない(条件を外して動かすと、思っていたより広く動く)
 *
 * モックには Slack が無いので、動いた実行はその場で「済み」にしてチャンネルの最終送信を進める
 * (チャンネルが要再接続・外されていれば失敗)。本物は送信待ちの台帳に入れ、送り係が確定後に送る
 */
import { ApiError } from '@/api/client'
import type { Filter, ObjectMeta, Row, SlackAction, Workflow, WorkflowInput, WorkflowRun, WorkflowTestResult } from '@/api/types'
import { defaultContext, matchFilter } from '@/lib/filter'
import { resolveDateMacro, todayISO } from '@/lib/dates'
import { ORIGIN_ORDER, filterFields } from '@/lib/workflow'
import { setWriteHooks, table, workspace, type Origin } from './engine'
import { liveObjects } from './schema'
import * as slack from './slack'

const STORAGE_KEY = 'works.mock.workflows.v1'
const MAX_NAME = 80
const MAX_ACTIONS = 10
const MAX_FIELDS = 20
const MAX_RUNS = 50

type StoredWorkflow = Omit<Workflow, 'last_run' | 'problems'> & { deleted_at: string | null }
/** 実行記録。送り先の名前は、読むときにチャンネルから引く(本番と同じ) */
type StoredRun = Omit<WorkflowRun, 'target'> & { channel: string | null }

interface Store {
  workflows: StoredWorkflow[]
  runs: StoredRun[]
}

let store: Store = load()

function load(): Store {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved) as Store
  } catch {
    // 壊れていたら空から
  }
  return { workflows: [], runs: [] }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // 保存できなくても画面は動かす
  }
}

export function resetWorkflows() {
  localStorage.removeItem(STORAGE_KEY)
  store = load()
}

const bad = (message: string) => new ApiError(400, 'invalid', message)

/** 条件が指してよい名前(ビューと同じ。polymorphic は 2 本の列でも指せる) */
function columnsOf(meta: ObjectMeta): Set<string> {
  const out = new Set<string>()
  for (const f of meta.fields) {
    out.add(f.key)
    if (f.columns) {
      out.add(f.columns.object)
      out.add(f.columns.id)
    }
  }
  return out
}

function values(filter: Filter): unknown[] {
  if ('and' in filter) return filter.and.flatMap(values)
  if ('or' in filter) return filter.or.flatMap(values)
  return Array.isArray(filter.value) ? filter.value : [filter.value]
}

/** 型に合わない値(日付の欄に日付でない文字、数の欄に数でないもの)。本番は SQL に訳すときに 400 */
function typeMismatch(meta: ObjectMeta, filter: Filter): string | null {
  if ('and' in filter || 'or' in filter) {
    for (const part of 'and' in filter ? filter.and : filter.or) {
      const found = typeMismatch(meta, part)
      if (found) return found
    }
    return null
  }
  const field = meta.fields.find((f) => f.key === filter.field)
  if (!field || filter.op === 'is_empty' || filter.op === 'is_not_empty') return null
  for (const v of Array.isArray(filter.value) ? filter.value : [filter.value]) {
    if (v === null || v === undefined) continue
    if ((field.type === 'date' || field.type === 'datetime') && typeof v === 'string') {
      const resolved = v.startsWith('$') ? resolveDateMacro(v, todayISO()) : v
      if (!resolved || Number.isNaN(Date.parse(resolved.slice(0, 10)))) return `${field.key} の条件の値が型に合いません: ${v}`
    }
    if (['number', 'currency', 'percent'].includes(field.type) && !Number.isFinite(Number(v))) return `${field.key} の条件の値が型に合いません: ${String(v)}`
  }
  return null
}

function checkFilter(meta: ObjectMeta, filter: Filter | undefined): Filter | undefined {
  if (!filter) return undefined
  if (values(filter).includes('$me')) throw bad('ワークフローの条件に「自分」は使えません。利用者を名指ししてください')
  const columns = columnsOf(meta)
  const unknown = filterFields(filter).find((k) => !columns.has(k))
  if (unknown !== undefined) throw bad(`条件が正しくありません: 知らない項目の条件です: ${unknown}`)
  const mismatch = typeMismatch(meta, filter)
  if (mismatch) throw bad(`条件が正しくありません: ${mismatch}`)
  return filter
}

function checkSlack(meta: ObjectMeta, action: Partial<SlackAction> & { id: string }): SlackAction {
  if (typeof action.channel !== 'string' || !slack.findChannel(action.channel)) throw bad('「Slack に知らせる」のチャンネルを選んでください')
  if (!Array.isArray(action.fields)) throw bad('載せる項目は列名の並びで指定してください')
  const fields: string[] = []
  for (const key of action.fields) {
    if (typeof key !== 'string' || !meta.fields.some((f) => f.key === key)) throw bad(`載せる項目が ${meta.label} にありません: ${String(key)}`)
    if (!fields.includes(key)) fields.push(key)
  }
  if (fields.length > MAX_FIELDS) throw bad(`載せる項目は ${MAX_FIELDS} 個までです`)
  return { id: action.id, type: 'slack', channel: action.channel, fields }
}

/** 画面から来た定義を確かめて整える。本番は `app/workflows/model.py` の `check`(文言も揃える) */
export function checkWorkflow(input: WorkflowInput): WorkflowInput {
  const name = String(input.name ?? '').trim()
  if (!name) throw bad('ワークフローの名前を入力してください')
  if (name.length > MAX_NAME) throw bad(`ワークフローの名前は ${MAX_NAME} 文字までです`)
  const meta = liveObjects().find((o) => o.key === input.object)
  if (!meta) throw bad('テーブルを選んでください')

  const trigger = input.trigger
  if (!trigger || (trigger.event !== 'created' && trigger.event !== 'matched')) throw bad('「いつ動かすか」を選んでください')
  const filter = checkFilter(meta, trigger.filter)
  if (trigger.event === 'matched' && !filter) throw bad('「条件を満たしたとき」には、条件を 1 つ以上入れてください')
  if (!Array.isArray(trigger.origins) || trigger.origins.some((o) => !ORIGIN_ORDER.includes(o))) throw bad('どこからの書き込みで動かすかが正しくありません')
  const origins = ORIGIN_ORDER.filter((o) => trigger.origins.includes(o))
  if (origins.length === 0) throw bad('どこからの書き込みで動かすかを 1 つ以上選んでください')

  if (!Array.isArray(input.actions) || input.actions.length === 0) throw bad('アクションを 1 つ以上足してください')
  if (input.actions.length > MAX_ACTIONS) throw bad(`アクションは ${MAX_ACTIONS} 個までです`)
  const seen = new Set<string>()
  const actions = input.actions.map((action) => {
    if (typeof action.id !== 'string' || !action.id || action.id.length > 64 || seen.has(action.id)) throw bad('アクションの id が正しくありません(重ならない文字で)')
    seen.add(action.id)
    if (action.type !== 'slack') throw bad(`知らないアクションです: ${String((action as { type: unknown }).type)}`)
    return checkSlack(meta, action)
  })
  if (typeof input.enabled !== 'boolean') throw bad('オン/オフは真偽で指定してください')
  return { name, enabled: input.enabled, object: meta.key, trigger: { event: trigger.event, ...(filter ? { filter } : {}), origins }, actions }
}

// --- 読み書き ----------------------------------------------------------------------

function problemsOf(w: StoredWorkflow): string[] {
  const meta = liveObjects().find((o) => o.key === w.object)
  if (!meta) return ['テーブルが削除されています。テーブルを元に戻すと動きます']
  const out: string[] = []
  const columns = columnsOf(meta)
  const missing = filterFields(w.trigger.filter).filter((k) => !columns.has(k))
  if (missing.length) out.push(`条件の項目 ${missing.join(', ')} がありません。条件を直すまで動きません`)
  for (const action of w.actions) {
    const channel = slack.findChannel(action.channel)
    if (!channel) out.push('「Slack に知らせる」のチャンネルが外されています')
    else if (channel.needs_reconnect) out.push(`チャンネル ${channel.channel_name} は要再接続です(環境設定の Slack から繋ぎ直してください)`)
  }
  return out
}

function toWorkflow(w: StoredWorkflow): Workflow {
  const last = store.runs.find((r) => r.workflow_id === w.id)
  const { deleted_at, ...rest } = w
  void deleted_at
  return structuredClone({
    ...rest,
    last_run: last ? { status: last.status, at: last.finished_at ?? last.created_at, error: last.error } : null,
    problems: problemsOf(w),
  })
}

function toRun(r: StoredRun): WorkflowRun {
  const { channel, ...rest } = r
  return structuredClone({ ...rest, target: slack.findChannel(channel)?.channel_name ?? null })
}

function stored(id: string, deleted = false): StoredWorkflow {
  const w = store.workflows.find((x) => x.id === id && (deleted ? x.deleted_at !== null : x.deleted_at === null))
  if (!w) throw new ApiError(404, 'not_found', 'ワークフローがありません')
  return w
}

export function listWorkflows(): Workflow[] {
  return store.workflows.filter((w) => w.deleted_at === null).map(toWorkflow)
}

export function createWorkflow(input: WorkflowInput, me: string): Workflow {
  const checked = checkWorkflow(input)
  const now = new Date().toISOString()
  const w: StoredWorkflow = { ...structuredClone(checked), id: crypto.randomUUID(), created_by: me, created_at: now, updated_at: now, deleted_at: null }
  store.workflows.push(w)
  save()
  return toWorkflow(w)
}

export function updateWorkflow(id: string, input: WorkflowInput): Workflow {
  const w = stored(id)
  Object.assign(w, structuredClone(checkWorkflow(input)), { updated_at: new Date().toISOString() })
  save()
  return toWorkflow(w)
}

export function deleteWorkflow(id: string) {
  stored(id).deleted_at = new Date().toISOString()
  save()
}

export function restoreWorkflow(id: string): Workflow {
  const w = stored(id, true)
  w.deleted_at = null
  save()
  return toWorkflow(w)
}

export function listRuns(id: string): WorkflowRun[] {
  stored(id)
  return store.runs.filter((r) => r.workflow_id === id).slice(0, MAX_RUNS).map(toRun)
}

/** そのチャンネルへ送るワークフローの名前(削除中は数えない) */
export function channelUsedBy(channelId: string): string[] {
  return store.workflows.filter((w) => w.deleted_at === null && w.actions.some((a) => a.channel === channelId)).map((w) => w.name)
}

/** チャンネルを外す。ワークフローが送り先に選んでいれば 409(外すと、そのワークフローが黙って届かなくなる) */
export function disconnectChannel(channelId: string) {
  if (!slack.findChannel(channelId)) throw new ApiError(404, 'not_found', 'チャンネルがありません')
  const names = channelUsedBy(channelId)
  if (names.length) {
    const others = names.length > 1 ? `ほか ${names.length - 1} 件` : ''
    throw new ApiError(409, 'channel_in_use', `ワークフロー「${names[0]}」${others}がこのチャンネルへ送っています。先にワークフローのチャンネルを替えてください`)
  }
  slack.removeChannel(channelId)
}

// --- 動かす ------------------------------------------------------------------------

/** その 1 行が条件を満たすか。条件が無い項目を指していれば満たさない */
function matches(meta: ObjectMeta, row: Row, filter: Filter | undefined): boolean {
  if (!filter) return true
  const columns = columnsOf(meta)
  if (filterFields(filter).some((k) => !columns.has(k))) return false
  return matchFilter(row, filter, defaultContext(null, workspace.timezone))
}

function candidates(meta: ObjectMeta, origin: Origin): StoredWorkflow[] {
  return store.workflows.filter((w) => w.object === meta.key && w.enabled && w.deleted_at === null && w.trigger.origins.includes(origin.kind))
}

/** 1 つのアクションを動かす。モックは Slack へは送らず、届いたことにする */
function execute(run: StoredRun) {
  const now = new Date().toISOString()
  run.attempts += 1
  const channel = slack.findChannel(run.channel)
  if (!channel) Object.assign(run, { status: 'failed', error: '送り先のチャンネルが外されています。ワークフローのチャンネルを選び直してください', finished_at: now })
  else if (channel.needs_reconnect) Object.assign(run, { status: 'failed', error: channel.last_error, finished_at: now })
  else {
    Object.assign(run, { status: 'done', error: null, finished_at: now })
    slack.recordSent(channel.id)
  }
}

function enqueue(w: StoredWorkflow, meta: ObjectMeta, row: Row, event: Workflow['trigger']['event'], origin: Origin) {
  for (const action of w.actions) {
    const run: StoredRun = {
      id: crypto.randomUUID(),
      workflow_id: w.id,
      action_id: action.id,
      action_type: action.type,
      object: meta.key,
      record_id: row.id,
      record_name: String(row[meta.name_field] ?? '').trim() || '(名前なし)',
      event,
      origin: origin.kind,
      actor_id: origin.actor,
      status: 'queued',
      attempts: 0,
      error: null,
      created_at: new Date().toISOString(),
      next_attempt_at: null,
      finished_at: null,
      channel: action.channel,
    }
    execute(run)
    // 新しい順に持つ
    store.runs.unshift(run)
  }
}

export function retryRun(runId: string): WorkflowRun {
  const run = store.runs.find((r) => r.id === runId)
  if (!run) throw new ApiError(404, 'not_found', '実行記録がありません')
  if (run.status !== 'failed' && run.status !== 'skipped') throw new ApiError(409, 'not_retryable', 'この実行は、送り直せる状態ではありません(失敗か見送りのものだけ)')
  const w = store.workflows.find((x) => x.id === run.workflow_id)
  if (!w || w.deleted_at !== null) throw bad('ワークフローが削除されています。元に戻してから送り直してください')
  Object.assign(run, { status: 'queued', attempts: 0, error: null, finished_at: null })
  execute(run)
  save()
  return toRun(run)
}

/** 保存前の定義のまま、アクションをその場で 1 回動かす(実行記録には残さない)。本番は `app/workflows/trial.py` */
export function testWorkflow(input: WorkflowInput): WorkflowTestResult {
  const checked = checkWorkflow(input)
  const meta = liveObjects().find((o) => o.key === checked.object)!
  const newest = [...table(meta.key)].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
  const record = (checked.trigger.filter ? newest.find((r) => matches(meta, r, checked.trigger.filter)) : undefined) ?? newest[0] ?? null
  const results = checked.actions.map((action) => {
    const channel = slack.findChannel(action.channel)
    if (!channel) return { action_id: action.id, ok: false, error: '送り先のチャンネルが外されています。ワークフローのチャンネルを選び直してください' }
    if (channel.needs_reconnect) return { action_id: action.id, ok: false, error: channel.last_error }
    slack.recordSent(channel.id)
    return { action_id: action.id, ok: true, error: null }
  })
  return { record: record ? { id: record.id, name: String(record[meta.name_field] ?? '').trim() || '(名前なし)' } : null, results }
}

setWriteHooks({
  afterInsert(meta, row, origin) {
    let fired = false
    for (const w of candidates(meta, origin)) {
      if (!matches(meta, row, w.trigger.filter)) continue
      enqueue(w, meta, row, w.trigger.event, origin)
      fired = true
    }
    if (fired) save()
  },
  beforeUpdate(meta, row, origin) {
    return new Set(candidates(meta, origin).filter((w) => w.trigger.event === 'matched' && matches(meta, row, w.trigger.filter)).map((w) => w.id))
  },
  afterUpdate(meta, row, origin, before) {
    let fired = false
    for (const w of candidates(meta, origin)) {
      if (w.trigger.event !== 'matched' || before.has(w.id) || !matches(meta, row, w.trigger.filter)) continue
      enqueue(w, meta, row, 'matched', origin)
      fired = true
    }
    if (fired) save()
  },
})
