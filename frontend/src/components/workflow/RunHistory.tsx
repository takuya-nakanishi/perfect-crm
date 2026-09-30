import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCw } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { MetaResponse, WorkflowRun } from '@/api/types'
import { Button, Tag } from '@/components/ui/basics'
import { formatDateTime } from '@/lib/dates'
import { usePeek } from '@/lib/usePeek'
import { ORIGINS, RUN_STATUS } from '@/lib/workflow'
import { useUI } from '@/state/ui'

/** 待ち・実行中があるあいだは読み直す(送り係が数秒で片付ける) */
const busy = (runs: WorkflowRun[] | undefined) => runs?.some((r) => r.status === 'queued' || r.status === 'running') ?? false

/**
 * ワークフローの実行記録(新しい順)。1 行 = 1 つのアクションを 1 回動かしたこと。
 * レコードの名前を押すと、そのレコードをパネルで開く。失敗と見送りは送り直せる
 */
export function RunHistory({ meta, workflowId }: { meta: MetaResponse; workflowId: string }) {
  const qc = useQueryClient()
  const toast = useUI((s) => s.toast)
  const { openPeek } = usePeek()
  const runs = useQuery({
    queryKey: ['workflow-runs', workflowId],
    queryFn: () => api.listWorkflowRuns(workflowId),
    refetchInterval: (q) => (busy(q.state.data) ? 2000 : false),
  })
  const retry = useMutation({
    mutationFn: (id: string) => api.retryWorkflowRun(id),
    onSuccess: (run) => {
      void qc.invalidateQueries({ queryKey: ['workflow-runs', workflowId] })
      void qc.invalidateQueries({ queryKey: ['workflows'] })
      toast(run.status === 'failed' ? { message: run.error ?? '送れませんでした', tone: 'danger' } : { message: 'もう一度送りました' })
    },
    onError: (e) => toast({ message: e instanceof ApiError ? e.message : '送り直せませんでした', tone: 'danger' }),
  })

  if (runs.isPending) return <div className="h-40" />
  if (!runs.data?.length) {
    return <p className="px-1 py-10 text-center text-ink-2">まだ動いていません。きっかけの書き込みがあると、ここに 1 件ずつ残ります</p>
  }
  return (
    <ol className="m-0 list-none p-0" aria-label="実行記録">
      {runs.data.map((run) => {
        const status = RUN_STATUS[run.status]
        const object = meta.objects.find((o) => o.key === run.object)
        const actor = meta.users.find((u) => u.id === run.actor_id)
        const where = run.origin === 'form' ? ORIGINS.form.label : actor ? `${actor.name}(${ORIGINS[run.origin].label})` : ORIGINS[run.origin].label
        return (
          <li key={run.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-start gap-x-3 border-b border-line py-2.5 last:border-b-0">
            <span className="pt-0.5">
              <Tag color={status.color}>{status.label}</Tag>
            </span>
            <div className="min-w-0">
              <p className="flex min-w-0 items-baseline gap-2">
                {object ? (
                  <button type="button" onClick={() => openPeek(run.object, run.record_id)} className="min-w-0 truncate font-bold decoration-line-strong underline-offset-4 hover:underline">
                    {run.record_name}
                  </button>
                ) : (
                  <span className="min-w-0 truncate font-bold">{run.record_name}</span>
                )}
                <span className="flex-none text-sm text-ink-3">{run.event === 'created' ? '作成' : '条件を満たした'}</span>
              </p>
              <p className="truncate text-sm text-ink-3">
                {where}
                {run.target && ` → ${run.target}`}
                {run.attempts > 1 && ` · ${run.attempts} 回目`}
              </p>
              {run.error && <p className="mt-0.5 text-sm text-danger">{run.error}</p>}
            </div>
            <div className="flex flex-col items-end gap-1">
              <time className="text-sm text-ink-3 tabular-nums" dateTime={run.finished_at ?? run.created_at}>
                {formatDateTime(run.finished_at ?? run.created_at)}
              </time>
              {(run.status === 'failed' || run.status === 'skipped') && (
                <Button size="sm" onClick={() => retry.mutate(run.id)} disabled={retry.isPending}>
                  <RotateCw size={13} aria-hidden />
                  送り直す
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
