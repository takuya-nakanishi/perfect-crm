import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Hash, Plus, Send, Trash2, X, Zap } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { api, ApiError } from '@/api/client'
import type { MetaResponse, SlackAction, Workflow, WorkflowInput, WorkflowOrigin } from '@/api/types'
import { Button, IconButton, Kbd, Switch } from '@/components/ui/basics'
import { ChoiceList } from '@/components/ui/ChoiceList'
import { Modal, Popover } from '@/components/ui/overlay'
import { Select } from '@/components/view/ConditionEditor'
import { useRecords } from '@/data/queries'
import { cx } from '@/lib/cx'
import { ACTION_KINDS, draftIssues, EVENTS, newSlackAction, ORIGIN_ORDER, ORIGINS, toWorkflowInput } from '@/lib/workflow'
import { useUI } from '@/state/ui'
import { ConditionChips } from './ConditionChips'
import { saveResume } from './resume'
import { RunHistory } from './RunHistory'
import { SlackActionBody } from './SlackActionCard'

const composing = (e: React.KeyboardEvent) => e.nativeEvent.isComposing

/** 流れの 1 段。左の背骨(印と、次の段へ続く線)と、右の中身 */
function Step({ marker, title, aside, last, children }: { marker: ReactNode; title: ReactNode; aside?: ReactNode; last?: boolean; children: ReactNode }) {
  return (
    <section className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3">
      <div className="flex flex-col items-center">
        {marker}
        {!last && <span className="mt-1 w-px flex-1 bg-line-strong" aria-hidden />}
      </div>
      <div className="min-w-0 pb-5">
        <header className="flex min-h-7 items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate font-bold">{title}</h3>
          {aside}
        </header>
        <div className="mt-2 rounded-lg p-4 shadow-[inset_0_0_0_1px_var(--line)]">{children}</div>
      </div>
    </section>
  )
}

const markerCls = 'grid size-7 flex-none place-items-center rounded-full'

function AddAction({ onAdd }: { onAdd: (type: SlackAction['type']) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3">
      <span className={cx(markerCls, 'text-ink-3 shadow-[inset_0_0_0_1px_var(--line-strong)]')}>
        <Plus size={14} aria-hidden />
      </span>
      <div>
        <button type="button" onClick={(e) => setAnchor(e.currentTarget)} className="inline-flex h-8 items-center rounded-md px-2 text-ink-2 hover:bg-sunken hover:text-ink">
          アクションを追加
        </button>
      </div>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={340}>
          <ChoiceList
            choices={ACTION_KINDS.map((k) => ({
              id: k.type,
              node: (
                <span className="flex min-w-0 items-start gap-2 py-0.5">
                  <Hash size={15} className="mt-0.5 flex-none text-ink-3" aria-hidden />
                  <span className="min-w-0">
                    <span className="block">{k.label}</span>
                    <span className="block text-sm text-ink-3">{k.hint}</span>
                  </span>
                </span>
              ),
              searchText: k.label,
              selected: false,
              commit: () => {
                setAnchor(null)
                onAdd(k.type)
              },
            }))}
          />
        </Popover>
      )}
    </div>
  )
}

/**
 * ワークフローを作る・直す。上から「きっかけ」→「アクション 1」→「アクション 2」…と縦に流れ、
 * 「アクションを追加」で動きを足せる(いまの種類は Slack に知らせる だけ。種類は lib/workflow.ts の ACTION_KINDS)。
 * 保存は明示(書きかけで動き出さないように)。閉じても書きかけは捨てず、トーストから戻れる
 */
export function WorkflowEditor({
  meta,
  workflow,
  initial,
  onClose,
  onReopen,
}: {
  meta: MetaResponse
  /** 直すワークフロー。新しく作るなら null */
  workflow: Workflow | null
  /** 書きかけから始める(Slack の許可から戻ったとき、トーストの「編集に戻る」) */
  initial: WorkflowInput
  onClose: () => void
  onReopen: (draft: WorkflowInput) => void
}) {
  const qc = useQueryClient()
  const toast = useUI((s) => s.toast)
  const [draft, setDraft] = useState<WorkflowInput>(initial)
  const [tab, setTab] = useState<'design' | 'runs'>('design')
  const [showIssues, setShowIssues] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const slack = useQuery({ queryKey: ['slack'], queryFn: () => api.slackStatus() })
  const objects = useMemo(() => [...meta.objects].sort((a, b) => a.position - b.position), [meta.objects])
  const object = meta.objects.find((o) => o.key === draft.object)
  const sample = useRecords(draft.object, { limit: 1, sort: [{ field: 'created_at', dir: 'desc' }] }, Boolean(object))
  const latest = sample.data?.records[0] ? { record: sample.data.records[0], references: sample.data.references } : null

  const pristine = useMemo(() => JSON.stringify(workflow ? toWorkflowInput(workflow) : null), [workflow])
  const dirty = JSON.stringify(draft) !== pristine
  const issues = draftIssues(draft)
  const channels = slack.data?.channels ?? []
  const title = workflow ? 'ワークフローを直す' : 'ワークフローを作る'

  const set = (patch: Partial<WorkflowInput>) => setDraft((d) => ({ ...d, ...patch }))
  const setTrigger = (patch: Partial<WorkflowInput['trigger']>) => setDraft((d) => ({ ...d, trigger: { ...d.trigger, ...patch } }))
  const setAction = (next: SlackAction) => setDraft((d) => ({ ...d, actions: d.actions.map((a) => (a.id === next.id ? next : a)) }))
  const moveAction = (index: number, delta: number) =>
    setDraft((d) => {
      const actions = [...d.actions]
      const to = index + delta
      if (to < 0 || to >= actions.length) return d
      actions.splice(to, 0, ...actions.splice(index, 1))
      return { ...d, actions }
    })
  const toggleOrigin = (origin: WorkflowOrigin) =>
    setTrigger({ origins: draft.trigger.origins.includes(origin) ? draft.trigger.origins.filter((o) => o !== origin) : ORIGIN_ORDER.filter((o) => o === origin || draft.trigger.origins.includes(o)) })

  const changeObject = (key: string) => {
    const next = meta.objects.find((o) => o.key === key)
    if (!next) return
    // 条件と載せる項目はテーブルごとなので、選び直す(チャンネルはそのまま)
    setDraft((d) => ({ ...d, object: key, trigger: { ...d.trigger, filter: undefined }, actions: d.actions.map((a) => ({ ...newSlackAction(meta, next, a.channel), id: a.id })) }))
  }

  const dismiss = () => {
    if (dirty) toast({ message: 'ワークフローを保存せずに閉じました', action: { label: '編集に戻る', run: () => onReopen(draft) } })
    onClose()
  }

  const addChannel = async (actionId: string) => {
    // Slack の許可の画面へ出て戻るあいだ、書きかけを預ける(戻ったら、足したチャンネルを入れて開き直す)
    saveResume({ id: workflow?.id ?? null, draft, actionId })
    try {
      const { url } = await api.slackConnect('/settings/workflows')
      location.assign(url)
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : 'Slack に繋げませんでした', tone: 'danger' })
    }
  }

  const focusFirstIssue = () => {
    if (issues.name) document.getElementById('workflow-name')?.focus()
  }

  const submit = async () => {
    if (saving) return
    if (issues.count > 0) {
      flushSync(() => setShowIssues(true))
      focusFirstIssue()
      return
    }
    setSaving(true)
    setServerError(null)
    try {
      const saved = workflow ? await api.updateWorkflow(workflow.id, draft) : await api.createWorkflow(draft)
      void qc.invalidateQueries({ queryKey: ['workflows'] })
      onClose()
      toast({ message: workflow ? `ワークフロー「${saved.name}」を保存しました` : `ワークフロー「${saved.name}」を作りました。${saved.enabled ? '次の書き込みから動きます' : 'オフのままです'}` })
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : '保存できませんでした。もう一度試してください')
      setSaving(false)
    }
  }

  const test = async () => {
    if (issues.count > 0) {
      flushSync(() => setShowIssues(true))
      focusFirstIssue()
      return
    }
    setTesting(true)
    setServerError(null)
    try {
      const result = await api.testWorkflow(draft)
      void qc.invalidateQueries({ queryKey: ['slack'] })
      const failed = result.results.find((r) => !r.ok)
      if (failed) toast({ message: failed.error ?? '送れませんでした', tone: 'danger' })
      else toast({ message: result.record ? `「${result.record.name}」の内容でテスト送信しました` : '見本の値でテスト送信しました(まだレコードがありません)' })
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : 'テスト送信できませんでした')
    } finally {
      setTesting(false)
    }
  }

  const remove = async () => {
    if (!workflow) return
    try {
      await api.deleteWorkflow(workflow.id)
      void qc.invalidateQueries({ queryKey: ['workflows'] })
      onClose()
      toast({
        message: `ワークフロー「${workflow.name}」を削除しました`,
        action: { label: '元に戻す', run: () => void api.restoreWorkflow(workflow.id).then(() => qc.invalidateQueries({ queryKey: ['workflows'] })) },
      })
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : '削除できませんでした')
    }
  }

  const origin = ORIGINS[draft.trigger.origins[0] ?? 'app'].label
  const labelCls = 'pt-2 text-sm text-ink-2'

  return (
    <Modal label={title} onClose={dismiss} className="h-[min(860px,100%)] max-w-[880px]">
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !composing(e)) {
            e.preventDefault()
            void submit()
          }
        }}
      >
        <header className="flex flex-none items-start gap-3 px-5 pt-5">
          <div className="min-w-0 flex-1">
            <input
              id="workflow-name"
              value={draft.name}
              aria-label="ワークフローの名前"
              aria-invalid={showIssues && Boolean(issues.name)}
              placeholder="ワークフローの名前(Slack の見出しになります)"
              onChange={(e) => set({ name: e.target.value })}
              className={cx(
                '-ml-2 h-10 w-full rounded-md bg-transparent px-2 text-xl font-bold outline-none placeholder:text-base placeholder:font-normal placeholder:text-ink-3 hover:bg-sunken focus:bg-paper focus:shadow-[inset_0_0_0_1.5px_var(--accent)]',
                showIssues && issues.name && 'shadow-[inset_0_0_0_1.5px_var(--danger)]',
              )}
            />
            {showIssues && issues.name && <p className="text-sm text-danger">{issues.name}</p>}
          </div>
          <label className="flex h-10 flex-none items-center gap-2 text-sm text-ink-2">
            {draft.enabled ? 'オン' : 'オフ'}
            <Switch checked={draft.enabled} label="このワークフローを動かす" onChange={(enabled) => set({ enabled })} />
          </label>
          <IconButton label="閉じる" onClick={dismiss} className="mt-1.5">
            <X size={16} />
          </IconButton>
        </header>
        {workflow && (
          <div role="tablist" aria-label="ワークフローの表示" className="flex flex-none gap-0.5 px-5 pt-1">
            {(
              [
                ['design', '設定'],
                ['runs', '実行記録'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('h-8 rounded-md px-2.5 text-sm', tab === k ? 'bg-sunken font-bold text-ink' : 'text-ink-2 hover:text-ink')}>
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto border-t border-line px-5 pt-5 pb-2">
          {tab === 'runs' && workflow ? (
            <RunHistory meta={meta} workflowId={workflow.id} />
          ) : (
            <>
              <Step
                marker={
                  <span className={cx(markerCls, 'bg-accent text-on-accent')}>
                    <Zap size={14} aria-hidden />
                  </span>
                }
                title="きっかけ"
              >
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
                  <span className={labelCls}>テーブル</span>
                  <div className="max-w-xs">
                    <Select value={draft.object} label="テーブル" onChange={changeObject}>
                      {objects.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <span className={labelCls}>いつ</span>
                  <div role="radiogroup" aria-label="いつ" className="grid gap-1.5 sm:grid-cols-2">
                    {EVENTS.map((ev) => {
                      const on = draft.trigger.event === ev.value
                      return (
                        <button
                          key={ev.value}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setTrigger({ event: ev.value })}
                          className={cx('rounded-md px-3 py-2 text-left', on ? 'bg-accent-wash shadow-[inset_0_0_0_1.5px_var(--accent)]' : 'shadow-[inset_0_0_0_1px_var(--line)] hover:bg-sunken')}
                        >
                          <span className={cx('flex items-center gap-2', on ? 'font-bold text-accent-ink' : 'text-ink')}>
                            <span className={cx('grid size-3.5 flex-none place-items-center rounded-full', on ? 'bg-accent' : 'shadow-[inset_0_0_0_1.5px_var(--line-strong)]')}>
                              {on && <span className="size-1.5 rounded-full bg-paper" />}
                            </span>
                            {ev.label}
                          </span>
                          <span className="mt-0.5 block pl-5.5 text-sm text-ink-3">{ev.hint}</span>
                        </button>
                      )
                    })}
                  </div>

                  <span className={labelCls}>
                    条件
                    {draft.trigger.event === 'created' && <span className="block text-xs text-ink-3">なくてもよい</span>}
                  </span>
                  <div className="min-w-0 pt-0.5">
                    {object && <ConditionChips key={draft.object} meta={meta} object={object} filter={draft.trigger.filter} onChange={(filter) => setTrigger({ filter })} invalid={showIssues && Boolean(issues.filter)} />}
                    {showIssues && issues.filter && <p className="mt-1 text-sm text-danger">{issues.filter}</p>}
                    {!(showIssues && issues.filter) && <p className="mt-1 text-sm text-ink-3">ビューのフィルターと同じ条件です</p>}
                  </div>

                  <span className={labelCls}>どこから</span>
                  <div className="min-w-0 pt-0.5">
                    <div role="group" aria-label="どこからの書き込みで動かすか" className="flex flex-wrap gap-1.5">
                      {ORIGIN_ORDER.map((o) => {
                        const on = draft.trigger.origins.includes(o)
                        return (
                          <button
                            key={o}
                            type="button"
                            role="switch"
                            aria-checked={on}
                            title={ORIGINS[o].hint}
                            onClick={() => toggleOrigin(o)}
                            className={cx('inline-flex h-8 items-center rounded-md px-2.5 text-base', on ? 'bg-accent-wash font-bold text-accent-ink' : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-sunken')}
                          >
                            {ORIGINS[o].label}
                          </button>
                        )
                      })}
                    </div>
                    {showIssues && issues.origins ? (
                      <p className="mt-1 text-sm text-danger">{issues.origins}</p>
                    ) : (
                      <p className="mt-1 text-sm text-ink-3">{draft.trigger.origins.includes('import') ? 'CSV の取り込みでは、取り込んだ件数だけ届きます' : 'CSV の取り込みは入れていません(取り込んだ件数だけ届くため)'}</p>
                    )}
                  </div>
                </div>
              </Step>

              {object &&
                draft.actions.map((action, i) => (
                  <Step
                    key={action.id}
                    marker={<span className={cx(markerCls, 'text-sm font-bold tabular-nums text-ink shadow-[inset_0_0_0_1.5px_var(--line-strong)]')}>{i + 1}</span>}
                    title={ACTION_KINDS.find((k) => k.type === action.type)?.label ?? action.type}
                    aside={
                      <span className="flex flex-none items-center">
                        {draft.actions.length > 1 && (
                          <>
                            <IconButton label="上へ" disabled={i === 0} onClick={() => moveAction(i, -1)}>
                              <ArrowUp size={14} />
                            </IconButton>
                            <IconButton label="下へ" disabled={i === draft.actions.length - 1} onClick={() => moveAction(i, 1)}>
                              <ArrowDown size={14} />
                            </IconButton>
                            <IconButton label="このアクションを外す" className="hover:bg-danger-wash hover:text-danger" onClick={() => set({ actions: draft.actions.filter((a) => a.id !== action.id) })}>
                              <Trash2 size={14} />
                            </IconButton>
                          </>
                        )}
                      </span>
                    }
                  >
                    <SlackActionBody
                      meta={meta}
                      object={object}
                      action={action}
                      channels={channels}
                      configured={slack.data?.configured ?? true}
                      title={draft.name}
                      event={draft.trigger.event}
                      origin={origin}
                      sample={latest}
                      issue={showIssues ? issues.actions[action.id] : undefined}
                      onChange={setAction}
                      onAddChannel={() => void addChannel(action.id)}
                    />
                  </Step>
                ))}

              {object && <AddAction onAdd={() => set({ actions: [...draft.actions, newSlackAction(meta, object, channels.length === 1 ? channels[0].id : null)] })} />}
            </>
          )}
        </div>

        <footer className="flex flex-none flex-wrap items-center gap-2 border-t border-line bg-chrome px-5 py-3">
          {workflow && (
            <Button variant="danger" onClick={() => void remove()}>
              <Trash2 size={14} aria-hidden />
              削除
            </Button>
          )}
          <p className={cx('min-w-0 flex-1 truncate text-sm', serverError ? 'text-danger' : 'text-ink-3')} role={serverError ? 'alert' : undefined} title={serverError ?? undefined}>
            {serverError ?? (showIssues && issues.count > 0 ? `${issues.count} か所を直してください` : '保存すると、次の書き込みから動きます')}
          </p>
          <Button variant="outline" onClick={() => void test()} disabled={testing || channels.length === 0} title="保存する前の中身で、いま 1 回だけ送ります(実行記録には残りません)">
            <Send size={14} aria-hidden />
            テスト送信
          </Button>
          <Button variant="ghost" onClick={dismiss}>
            キャンセル
          </Button>
          <Button variant="primary" type="submit" disabled={saving || (Boolean(workflow) && !dirty)}>
            {workflow ? '保存' : '作る'}
            <span className="hidden opacity-80 sm:inline-flex sm:gap-0.5">
              <Kbd>Ctrl</Kbd>
              <Kbd>Enter</Kbd>
            </span>
          </Button>
        </footer>
      </form>
    </Modal>
  )
}
