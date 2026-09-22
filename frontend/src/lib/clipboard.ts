import { useUI } from '@/state/ui'

/** 文字をクリップボードへ。できたらトーストで知らせる */
export async function copyText(text: string, what = 'コピーしました') {
  try {
    await navigator.clipboard.writeText(text)
    useUI.getState().toast({ message: what })
  } catch {
    useUI.getState().toast({ message: 'コピーできませんでした。手で選んでコピーしてください', tone: 'danger' })
  }
}
