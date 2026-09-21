import { useCallback, useState } from 'react'
import type { Filter, ObjectMeta, Row } from '@/api/types'
import { defaultContext, matchFilter } from '@/lib/filter'
import { useToggleComplete } from './mutations'
import { useSession } from './queries'

const LEAVE_MS = 200

/**
 * チェックで完了にする操作。押した瞬間にチェックが入り、そのビューから外れる行は
 * 抜ける動きを見せてからデータを書き換える(待たせないが、何が起きたかは見える)。
 */
export function useCompletion(meta: ObjectMeta, filter: Filter | undefined) {
  const toggle = useToggleComplete()
  const me = useSession().data?.user.id ?? null
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set())

  const complete = useCallback(
    (row: Row) => {
      const c = meta.completion
      if (!c || leaving.has(row.id)) return
      const nextValue = row[c.field] === c.done_value ? c.open_value : c.done_value
      const staysInView = matchFilter({ ...row, [c.field]: nextValue }, filter, defaultContext(me))
      if (staysInView) {
        toggle(meta, row)
        return
      }
      setLeaving((prev) => new Set(prev).add(row.id))
      setTimeout(() => {
        toggle(meta, row)
        setTimeout(() => {
          setLeaving((prev) => {
            const next = new Set(prev)
            next.delete(row.id)
            return next
          })
        }, 600)
      }, LEAVE_MS)
    },
    [meta, filter, me, leaving, toggle],
  )

  const isChecked = useCallback(
    (row: Row) => {
      const c = meta.completion
      if (!c) return false
      const done = row[c.field] === c.done_value
      // 抜けていく途中の行は、切り替え後の見た目を先に出す
      return leaving.has(row.id) ? !done : done
    },
    [meta, leaving],
  )

  return { leaving, complete, isChecked }
}
