import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { AggregateParams, ListParams, MetaResponse, ObjectMeta, ViewMeta } from '@/api/types'

/** キャッシュのキー。更新系(mutations.ts)が同じ形で無効化する */
export const keys = {
  session: ['session'] as const,
  meta: ['meta'] as const,
  records: (object: string, params?: ListParams) => (params ? (['records', object, params] as const) : (['records', object] as const)),
  record: (object: string, id: string) => ['record', object, id] as const,
  aggregate: (object: string, params?: AggregateParams) =>
    params ? (['aggregate', object, params] as const) : (['aggregate', object] as const),
  search: (q: string) => ['search', q] as const,
  timeline: (object: string, id: string) => ['timeline', object, id] as const,
}

export function useSession() {
  return useQuery({ queryKey: keys.session, queryFn: () => api.getSession(), staleTime: Infinity })
}

export function useMeta(enabled = true) {
  return useQuery({ queryKey: keys.meta, queryFn: () => api.getMeta(), staleTime: Infinity, enabled })
}

/** 最初に開く場所。お気に入りの先頭(今日のタスク)、無ければ最初のテーブル */
export function homePath(meta: MetaResponse): string {
  const pinned = meta.views.filter((v) => v.pin).sort((a, b) => (a.pin?.position ?? 0) - (b.pin?.position ?? 0))[0]
  if (pinned) return `/o/${pinned.object}?view=${pinned.id}`
  const first = meta.objects.filter((o) => o.in_sidebar).sort((a, b) => a.position - b.position)[0]
  return first ? `/o/${first.key}` : '/login'
}

export function findObject(meta: MetaResponse | undefined, key: string | undefined): ObjectMeta | undefined {
  return meta?.objects.find((o) => o.key === key)
}

export function viewsOf(meta: MetaResponse | undefined, object: string): ViewMeta[] {
  return (meta?.views ?? []).filter((v) => v.object === object).sort((a, b) => a.position - b.position)
}

export function useRecords(object: string, params: ListParams, enabled = true) {
  return useQuery({
    queryKey: keys.records(object, params),
    queryFn: () => api.listRecords(object, params),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useRecord(object: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: keys.record(object ?? '', id ?? ''),
    queryFn: () => api.getRecord(object!, id!),
    enabled: Boolean(object && id),
  })
}

export function useAggregate(object: string, params: AggregateParams, enabled = true) {
  return useQuery({
    queryKey: keys.aggregate(object, params),
    queryFn: () => api.aggregate(object, params),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useTimeline(object: string, id: string) {
  return useQuery({ queryKey: keys.timeline(object, id), queryFn: () => api.getTimeline(object, id), placeholderData: keepPreviousData })
}

export function useSearch(q: string) {
  return useQuery({
    queryKey: keys.search(q),
    queryFn: () => api.search(q),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
}
