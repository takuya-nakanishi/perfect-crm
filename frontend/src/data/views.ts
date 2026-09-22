import { useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { api, ApiError } from '@/api/client'
import type { MetaResponse, ViewInput, ViewMeta } from '@/api/types'
import { useUI } from '@/state/ui'
import { keys } from './queries'

/**
 * ビュー(タブ)の変更。Notion と同じで、フィルター・並び替え・設定は触ったその場で保存する。
 * 先にメタデータのキャッシュを書き換え(楽観更新)、サーバの応答で確定する。失敗したら戻して知らせる
 */
export function useViewMutations() {
  const qc = useQueryClient()
  const toast = useUI((s) => s.toast)

  // 変えるたびに保存を送るので、応答が前後することがある。最後に送ったものの応答だけを採る(古い応答で戻さない)
  const seq = useRef(0)
  const apply = (next: MetaResponse) => qc.setQueryData(keys.meta, next)
  const applyIfLatest = (mine: number) => (next: MetaResponse) => {
    if (mine === seq.current) apply(next)
  }
  const patchMeta = (change: (meta: MetaResponse) => MetaResponse) => {
    const before = qc.getQueryData<MetaResponse>(keys.meta)
    if (before) qc.setQueryData(keys.meta, change(before))
    return before
  }
  const fail = (before: MetaResponse | undefined, e: unknown, fallback: string) => {
    if (before) qc.setQueryData(keys.meta, before)
    toast({ message: e instanceof ApiError ? e.message : fallback, tone: 'danger' })
  }

  return {
    /** 変更をその場で保存する(トーストは出さない。Notion と同じ) */
    save(view: ViewMeta, input: ViewInput) {
      const before = patchMeta((m) => ({
        ...m,
        views: m.views.map((v) => (v.id === view.id ? ({ ...input, id: v.id, object: v.object, position: v.position, pin: input.pin ? { ...input.pin, position: v.pin?.position ?? 999 } : undefined } as ViewMeta) : v)),
      }))
      const mine = ++seq.current
      api
        .updateView(view.id, input)
        .then(applyIfLatest(mine))
        .catch((e) => fail(mine === seq.current ? before : undefined, e, 'ビューを保存できませんでした。もう一度試してください'))
    },
    /** 作成。応答のメタデータから新しい id を見つけて返す */
    async create(object: string, input: ViewInput): Promise<string | null> {
      const known = new Set((qc.getQueryData<MetaResponse>(keys.meta)?.views ?? []).map((v) => v.id))
      try {
        const next = await api.createView(object, input)
        apply(next)
        return next.views.find((v) => v.object === object && !known.has(v.id))?.id ?? null
      } catch (e) {
        fail(undefined, e, 'ビューを作れませんでした。もう一度試してください')
        return null
      }
    },
    remove(view: ViewMeta) {
      const before = patchMeta((m) => ({ ...m, views: m.views.filter((v) => v.id !== view.id) }))
      api
        .deleteView(view.id)
        .then((next) => {
          apply(next)
          toast({ message: `ビュー「${view.name}」を削除しました`, action: { label: '元に戻す', run: () => void api.restoreView(view.id).then(apply) } })
        })
        .catch((e) => fail(before, e, 'ビューを削除できませんでした'))
    },
    reorder(object: string, ids: string[]) {
      const positions = new Map(ids.map((id, i) => [id, i + 1]))
      const before = patchMeta((m) => ({ ...m, views: m.views.map((v) => (positions.has(v.id) ? { ...v, position: positions.get(v.id)! } : v)) }))
      api
        .reorderViews(object, ids)
        .then(apply)
        .catch((e) => fail(before, e, '並びを保存できませんでした'))
    },
  }
}
