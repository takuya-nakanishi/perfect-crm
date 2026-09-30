import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, Hash, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router'
import { api } from '@/api/client'
import type { MetaResponse, SlackChannel, Workflow, WorkflowInput } from '@/api/types'
import { Button, ObjectIcon, Switch, Tag } from '@/components/ui/basics'
import { WorkflowEditor } from '@/components/workflow/WorkflowEditor'
import { takeResume } from '@/components/workflow/resume'
import { formatDateTime } from '@/lib/dates'
import { describe, flatten } from '@/lib/viewModel'
import { describeOrigins, describeTrigger, newWorkflowDraft, RUN_STATUS, toWorkflowInput } from '@/lib/workflow'
import { useUI } from '@/state/ui'
import { SectionHeader } from './SettingsPage'

/** Slack の許可の画面から戻ったときの知らせ(?slack=) */
const OUTCOMES: Record<string, { message: string; tone?: 'danger' }> = {
  connected: { message: 'Slack のチャンネルを足しました' },
  denied: { message: 'Slack での許可を取りやめました' },
  error: { message: 'Slack と繋げませんでした。もう一度お試しください', tone: 'danger' },
}

/** 条件を 1 行の文に(「関係 が やり取り中」かつ…)。入れ子は「高度な条件」 */
function conditionText(meta: MetaResponse, w: Workflow): string | null {
  const object = meta.objects.find((o) => o.key === w.object)
  const flat = flatten(w.trigger.filter)
  if (!object || (flat.conditions.length === 0 && flat.advanced.length === 0)) return null
  const parts = flat.conditions.map((c) => {
    const field = object.fields.find((f) => f.key === c.field)
    if (!field) return `${c.field}(外された項目)`
    const d = describe(meta, field, c)
    return [field.label, d.op, d.value].filter(Boolean).join(' ')
  })
  if (flat.advanced.length) parts.push('高度な条件')
  return parts.join(flat.join === 'and' ? '、かつ ' : '、または ')
}

function WorkflowRow({ meta, workflow, channels, onOpen }: { meta: MetaResponse; workflow: Workflow; channels: SlackChannel[]; onOpen: () => void }) {
  const qc = useQueryClient()
  const toast = useUI((s) => s.toast)
  const object = meta.objects.find((o) => o.key === workflow.object)
  const condition = conditionText(meta, workflow)
  const origins = describeOrigins(workflow.trigger.origins)
  const targets = workflow.actions.map((a) => channels.find((c) => c.id === a.channel)?.channel_name ?? '(外されたチャンネル)')
  const last = workflow.last_run

  const toggle = (enabled: boolean) => {
    // 楽観更新。定義は全量で送る(契約が PUT 1 本だから)
    const before = qc.getQueryData<Workflow[]>(['workflows'])
    qc.setQueryData<Workflow[]>(['workflows'], (list) => list?.map((w) => (w.id === workflow.id ? { ...w, enabled } : w)))
    api
      .updateWorkflow(workflow.id, { ...toWorkflowInput(workflow), enabled })
      .then(() => qc.invalidateQueries({ queryKey: ['workflows'] }))
      .catch(() => {
        qc.setQueryData(['workflows'], before)
        toast({ message: '切り替えられませんでした。もう一度試してください', tone: 'danger' })
      })
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-workflow={workflow.name}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen()
      }}
      className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-4 border-b border-line px-2 py-3 hover:bg-chrome md:grid-cols-[auto_minmax(0,1fr)_minmax(0,14rem)_auto]"
    >
      <span className="pt-0.5">
        <Switch checked={workflow.enabled} label={`「${workflow.name}」を動かす`} onChange={toggle} />
      </span>
      <div className="min-w-0">
        <p className="truncate font-bold">{workflow.name}</p>
        <p className="flex min-w-0 items-center gap-1.5 text-sm text-ink-2">
          {object && <ObjectIcon icon={object.icon} color={object.color} size={14} />}
          <span className="truncate">
            {describeTrigger(object, workflow.trigger)}
            {origins && <span className="text-ink-3">({origins})</span>}
          </span>
        </p>
        {condition && <p className="truncate text-sm text-ink-3">条件: {condition}</p>}
        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-ink-2 md:hidden">
          <Hash size={13} className="flex-none text-ink-3" aria-hidden />
          <span className="truncate">{targets.join('、')} に知らせる</span>
          {last && <Tag color={RUN_STATUS[last.status].color} className="ml-1 flex-none">{RUN_STATUS[last.status].label}</Tag>}
        </p>
        {workflow.problems.map((p) => (
          <p key={p} className="mt-0.5 flex items-start gap-1.5 text-sm text-warn">
            <AlertTriangle size={14} className="mt-0.5 flex-none" aria-hidden />
            {p}
          </p>
        ))}
      </div>
      <div className="hidden min-w-0 md:block">
        <p className="flex min-w-0 items-center gap-1 text-sm">
          <Hash size={13} className="flex-none text-ink-3" aria-hidden />
          <span className="truncate">{targets.join('、')}</span>
        </p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-ink-3">
          {last ? (
            <>
              <Tag color={RUN_STATUS[last.status].color}>{RUN_STATUS[last.status].label}</Tag>
              <span className="truncate tabular-nums">{formatDateTime(last.at)}</span>
            </>
          ) : (
            'まだ動いていません'
          )}
        </p>
      </div>
      <ChevronRight size={16} className="mt-1 text-ink-3" aria-hidden />
    </div>
  )
}

/**
 * ワークフロー(04 §15)。「どのテーブルで・いつ・どの条件で」レコードが書かれたら、「何をするか」(いまは Slack に知らせる)。
 * 一覧は罫線の表(カードを並べない。05 §4)。行を押すと、きっかけ → アクションの流れで開く
 */
export function WorkflowsSettings() {
  const meta = useOutletContext<MetaResponse>()
  const toast = useUI((s) => s.toast)
  const [params, setParams] = useSearchParams()
  // どこから書いても動くので、開くたびに読み直す(直近の実行を古いまま見せない)
  const workflows = useQuery({ queryKey: ['workflows'], queryFn: () => api.listWorkflows(), staleTime: 0, refetchOnMount: 'always' })
  const slack = useQuery({ queryKey: ['slack'], queryFn: () => api.slackStatus() })
  const channels = slack.data?.channels ?? []
  const [editing, setEditing] = useState<{ workflow: Workflow | null; draft: WorkflowInput } | null>(null)
  const objects = [...meta.objects].sort((a, b) => a.position - b.position)

  const open = (workflow: Workflow | null, draft?: WorkflowInput) => {
    const first = objects[0]
    if (!first) return
    setEditing({ workflow, draft: draft ?? (workflow ? toWorkflowInput(workflow) : newWorkflowDraft(meta, first, channels.length === 1 ? channels[0].id : null)) })
  }

  // Slack の許可の画面から戻ったとき(?slack=connected&channel=…)は、預けた書きかけを最初の描画で 1 回だけ取り出し、
  // 足したチャンネルを入れて開き直す(閉じるまで、または別のワークフローを開くまで)
  const [returned] = useState(() => {
    const outcome = params.get('slack')
    return outcome ? { outcome, channel: params.get('channel'), resume: takeResume() } : null
  })
  const [resumeClosed, setResumeClosed] = useState(false)
  const resume = returned?.resume
  const resumed =
    resume && !resumeClosed && workflows.data
      ? {
          workflow: workflows.data.find((w) => w.id === resume.id) ?? null,
          draft: {
            ...resume.draft,
            actions: resume.draft.actions.map((a) => (a.id === resume.actionId && returned.outcome === 'connected' && returned.channel ? { ...a, channel: returned.channel } : a)),
          },
        }
      : null
  const shown = editing ?? resumed
  const told = useRef(false)
  useEffect(() => {
    if (!returned || told.current) return
    told.current = true
    const known = OUTCOMES[returned.outcome]
    if (known) toast(known)
    setParams(
      (p) => {
        p.delete('slack')
        p.delete('channel')
        return p
      },
      { replace: true },
    )
  }, [returned, setParams, toast])

  return (
    <>
      <SectionHeader title="ワークフロー" hint="レコードが作られたとき、条件を満たしたときに、決めた動きをします。いまの動きは「Slack に知らせる」です">
        <Button variant="primary" onClick={() => open(null)}>
          <Plus size={15} strokeWidth={2.5} aria-hidden />
          ワークフローを作る
        </Button>
      </SectionHeader>
      <div className="px-5 pb-10 md:px-8">
        {workflows.data?.length === 0 && (
          <div className="rounded-lg px-5 py-8 shadow-[inset_0_0_0_1px_var(--line)]">
            <p className="font-bold">まだワークフローはありません</p>
            <p className="mt-1 text-ink-2">たとえば、次のようなことができます。「ワークフローを作る」から、テーブルと「いつ」を選んでください。</p>
            <ul className="mt-3 grid list-disc gap-1 pl-5 text-ink-2">
              <li>リードが作成されたら、#leads に知らせる</li>
              <li>商談のフェーズが「受注」になったら、#sales に知らせる</li>
              <li>Web フォームから問い合わせが来たら、担当のチャンネルに知らせる</li>
            </ul>
          </div>
        )}
        {Boolean(workflows.data?.length) && (
          <>
            <div className="hidden grid-cols-[auto_minmax(0,1fr)_minmax(0,14rem)_auto] items-center gap-x-4 border-b border-line px-2 pb-2 text-sm text-ink-2 md:grid">
              <span className="w-9">オン</span>
              <span>いつ</span>
              <span>知らせる先 · 直近の実行</span>
              <span className="w-4" />
            </div>
            {workflows.data?.map((w) => (
              <WorkflowRow key={w.id} meta={meta} workflow={w} channels={channels} onOpen={() => open(w)} />
            ))}
          </>
        )}
        <details className="mt-6 text-sm text-ink-2">
          <summary className="cursor-pointer text-ink">仕組み</summary>
          <ul className="mt-2 grid gap-1 pl-5">
            <li>画面・Web フォーム・AI(MCP)・CSV のどこから書いても、同じところで判定します。「どこから」で、動かす書き込みを選べます</li>
            <li>「条件を満たしたとき」は、満たしていなかったレコードが満たした瞬間に 1 回だけ動きます。満たしたまま直しても、もう一度は動きません</li>
            <li>条件はビューのフィルターと同じ意味です。「自分」は使えません(誰の書き込みでも動くため)</li>
            <li>送るのは保存が確定したあとです。取り消された書き込みは送りません。Slack が止まっていても、間を空けて 5 回まで送り直します</li>
            <li>オフにすると、まだ送っていない分も見送ります。実行記録の「送り直す」で、失敗した分をもう一度送れます</li>
          </ul>
        </details>
      </div>
      {shown && (
        <WorkflowEditor
          key={shown.workflow?.id ?? 'new'}
          meta={meta}
          workflow={shown.workflow}
          initial={shown.draft}
          onClose={() => {
            setEditing(null)
            setResumeClosed(true)
          }}
          onReopen={(draft) => setEditing({ workflow: shown.workflow, draft })}
        />
      )}
    </>
  )
}
