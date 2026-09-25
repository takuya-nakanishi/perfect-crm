import { useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { api, ApiError } from '@/api/client'
import type { MetaResponse, SidebarItem } from '@/api/types'
import { applySidebar } from '@/lib/sidebar'
import { useUI } from '@/state/ui'
import { keys } from './queries'

/**
 * サイドバーの並びとフォルダの保存(PUT /meta/sidebar。05 §13)。
 * 並びは全量で送るので、どの操作(並べ替え・フォルダへ移す・フォルダを作る・名前を変える・消す)も同じ 1 本を通る。
 * 先に手元のメタデータへ当て(楽観更新)、サーバの応答で確定する。失敗したら戻して知らせる
 */
export function useSidebarMutations() {
  const qc = useQueryClient()
  // 続けて動かすと応答が前後することがある。最後に送ったものの応答だけを採る(古い応答で戻さない)
  const seq = useRef(0)

  const save = (items: SidebarItem[], done?: { message: string; undo: SidebarItem[] }) => {
    const before = qc.getQueryData<MetaResponse>(keys.meta)
    if (before) qc.setQueryData(keys.meta, applySidebar(before, items))
    const mine = ++seq.current
    api
      .saveSidebar(items)
      .then((next) => {
        if (mine === seq.current) qc.setQueryData(keys.meta, next)
        // 「元に戻す」は前の並びをもう一度送るだけ(消したフォルダも同じ id で戻る)
        if (done) useUI.getState().toast({ message: done.message, action: { label: '元に戻す', run: () => save(done.undo) } })
      })
      .catch((e: unknown) => {
        if (mine === seq.current && before) qc.setQueryData(keys.meta, before)
        useUI.getState().toast({ message: e instanceof ApiError ? e.message : '並びを保存できませんでした。もう一度試してください', tone: 'danger' })
      })
  }
  return { save }
}
