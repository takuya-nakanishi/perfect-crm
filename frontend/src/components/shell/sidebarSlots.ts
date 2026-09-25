import { createContext } from 'react'
import type { DropZone, SidebarDrop, SidebarRef } from '@/lib/sidebar'

/**
 * サイドバーの木(SidebarTree)に、つまむ・落とすを差し込む口。
 * ドラッグの部品(dnd-kit)は最初の表示に要らないので別ファイル(SidebarDnd)にあり、届くまでは既定の「動かない行」で描く。
 * 差し込むのはフック。同じ木の中では入れ替わらない(動かない木とドラッグできる木は、Suspense が別々に描く)ので、フックの順は崩れない
 */

export interface DndInput {
  /** サイドバーの中で重ならない名前 */
  id: string
  /** つまんで動かすもの(無ければ受け口だけ) */
  drag?: SidebarRef
  /** 受け口(無ければつまむだけ) */
  zone?: DropZone
  /** 受ける種類(テーブルかフォルダか) */
  accept?: SidebarRef['type'][]
}

export interface DndBind {
  /** つまむ要素で、受け口の要素 */
  ref?: (el: HTMLElement | null) => void
  /** つまんで動かしている最中の元 */
  dragging: boolean
}

export type UseDnd = (input: DndInput) => DndBind

const STILL: DndBind = { dragging: false }

export const DndHook = createContext<UseDnd>(() => STILL)

/** いまの落とす先。線と囲みを、ここが指す行に描く */
export const DropTarget = createContext<SidebarDrop | null>(null)
