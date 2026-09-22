import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { ListParams, ListResponse, ObjectMeta, RecordResponse, References, Row, Scalar } from '@/api/types'
import { defaultContext, matchFilter } from '@/lib/filter'
import { useUI } from '@/state/ui'
import { keys, useSession } from './queries'

/**
 * 更新系。どれも「先に画面を書き換え、あとからサーバに合わせる」(楽観更新)。
 * 失敗したら元に戻してトーストで知らせる。
 */

interface UpdateVars {
  object: string
  id: string
  patch: Record<string, Scalar>
  /** 参照先を変えたとき、その表示名を先に画面へ出すための情報 */
  refs?: References
}

function mergeRefs(base: References, extra?: References): References {
  if (!extra) return base
  const out: References = { ...base }
  for (const [object, byId] of Object.entries(extra)) out[object] = { ...out[object], ...byId }
  return out
}

/** キャッシュ済みの一覧すべてに変更を当てる。条件から外れた行はその一覧から抜く */
function patchLists(qc: QueryClient, object: string, me: string | null, change: (row: Row) => Row | null, refs?: References) {
  const ctx = defaultContext(me)
  for (const query of qc.getQueryCache().findAll({ queryKey: keys.records(object) })) {
    const params = (query.queryKey[2] ?? {}) as ListParams
    qc.setQueryData<ListResponse>(query.queryKey, (old) => {
      if (!old) return old
      let removed = 0
      const records: Row[] = []
      for (const row of old.records) {
        const next = change(row)
        if (next === null || !matchFilter(next, params.filter, ctx)) removed++
        else records.push(next)
      }
      return { records, total: old.total - removed, references: mergeRefs(old.references, refs) }
    })
  }
}

function snapshotLists(qc: QueryClient, object: string) {
  return qc.getQueriesData<ListResponse>({ queryKey: keys.records(object) })
}

function restoreLists(qc: QueryClient, snapshot: ReturnType<typeof snapshotLists>) {
  for (const [key, data] of snapshot) qc.setQueryData(key, data)
}

/** 関連テーブルの表示名や集計にも響くので、読み直しは広めにかける(件数が小さい前提) */
function refreshAll(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['records'] })
  void qc.invalidateQueries({ queryKey: ['record'] })
  void qc.invalidateQueries({ queryKey: ['aggregate'] })
  void qc.invalidateQueries({ queryKey: ['timeline'] })
  void qc.invalidateQueries({ queryKey: ['search'] })
}

export function useUpdateRecord() {
  const qc = useQueryClient()
  const me = useSession().data?.user.id ?? null
  return useMutation({
    mutationFn: ({ object, id, patch }: UpdateVars) => api.updateRecord(object, id, patch),
    async onMutate({ object, id, patch, refs }) {
      await qc.cancelQueries({ queryKey: keys.records(object) })
      await qc.cancelQueries({ queryKey: keys.record(object, id) })
      const lists = snapshotLists(qc, object)
      const single = qc.getQueryData<RecordResponse>(keys.record(object, id))
      patchLists(qc, object, me, (row) => (row.id === id ? { ...row, ...patch } : row), refs)
      qc.setQueryData<RecordResponse>(keys.record(object, id), (old) =>
        old ? { record: { ...old.record, ...patch }, references: mergeRefs(old.references, refs) } : old,
      )
      return { lists, single }
    },
    onError(_error, { object, id }, context) {
      if (context) {
        restoreLists(qc, context.lists)
        qc.setQueryData(keys.record(object, id), context.single)
      }
      useUI.getState().toast({ message: '保存できませんでした。もう一度試してください', tone: 'danger' })
    },
    onSettled: () => refreshAll(qc),
  })
}

export function useCreateRecord() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ object, values }: { object: string; values: Record<string, Scalar> }) => api.createRecord(object, values),
    onError() {
      useUI.getState().toast({ message: '作成できませんでした。もう一度試してください', tone: 'danger' })
    },
    onSettled: () => refreshAll(qc),
  })
}

export function useDeleteRecord() {
  const qc = useQueryClient()
  const me = useSession().data?.user.id ?? null
  return useMutation({
    mutationFn: ({ object, row }: { object: string; row: Row; label: string }) => api.deleteRecord(object, row.id),
    async onMutate({ object, row }) {
      await qc.cancelQueries({ queryKey: keys.records(object) })
      const lists = snapshotLists(qc, object)
      patchLists(qc, object, me, (r) => (r.id === row.id ? null : r))
      return { lists }
    },
    onSuccess(_data, { object, row, label }) {
      useUI.getState().toast({
        message: `${label}を削除しました`,
        action: {
          label: '元に戻す',
          run: () => void api.restoreRecord(object, row).then(() => refreshAll(qc)),
        },
      })
    },
    onError(_error, _vars, context) {
      if (context) restoreLists(qc, context.lists)
      useUI.getState().toast({ message: '削除できませんでした。もう一度試してください', tone: 'danger' })
    },
    onSettled: () => refreshAll(qc),
  })
}

/** タスクの完了と、その取り消し。完了にした行はその場で一覧から消える(完了済みのビューには現れる) */
export function useToggleComplete() {
  const update = useUpdateRecord()
  return (meta: ObjectMeta, row: Row) => {
    const c = meta.completion
    if (!c) return
    const wasDone = row[c.field] === c.done_value
    const previous = row[c.field] ?? c.open_value
    update.mutate({ object: meta.key, id: row.id, patch: { [c.field]: wasDone ? c.open_value : c.done_value } })
    if (!wasDone) {
      useUI.getState().toast({
        message: '完了にしました',
        action: {
          label: '元に戻す',
          run: () => update.mutate({ object: meta.key, id: row.id, patch: { [c.field]: previous } }),
        },
      })
    }
  }
}
