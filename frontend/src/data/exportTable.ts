import { api } from '@/api/client'
import type { ObjectMeta } from '@/api/types'
import { todayISO } from '@/lib/dates'
import { downloadBlob } from '@/lib/download'
import { useUI } from '@/state/ui'

/** テーブルを CSV に書き出して保存させる。歯車のメニューと、取り込みの画面の「見本」から呼ぶ */
export async function exportTable(object: ObjectMeta) {
  try {
    downloadBlob(await api.exportRecords(object.key), `${object.label}_${todayISO()}.csv`)
    useUI.getState().toast({ message: `${object.label}を CSV に書き出しました` })
  } catch {
    useUI.getState().toast({ message: '書き出せませんでした。もう一度試してください', tone: 'danger' })
  }
}
