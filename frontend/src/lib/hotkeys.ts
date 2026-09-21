import { useEffect, useRef } from 'react'

/** 文字を打っている最中か。打っているなら 1 文字のショートカットは効かせない */
export function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** Ctrl / Cmd / Alt を伴わない素のキーか */
export function isPlainKey(e: KeyboardEvent): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey
}

/**
 * document の keydown を購読する。日本語入力の変換中(isComposing)は常に無視する
 * (変換確定の Enter や、変換中の文字がショートカットに化けるのを防ぐ)。
 */
export function useKeydown(handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    if (!enabled) return
    const listener = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      ref.current(e)
    }
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [enabled])
}

/** 画面に出すショートカットの一覧。join はキーのつなぎ方(+ = 同時押し / then = 続けて押す / or = どちらでも) */
export interface ShortcutItem {
  keys: string[]
  join?: '+' | 'then' | 'or'
  label: string
}

export const SHORTCUTS: { group: string; items: ShortcutItem[] }[] = [
  {
    group: 'どこでも',
    items: [
      { keys: ['Q'], label: 'タスクを追加' },
      { keys: ['/'], label: '検索' },
      { keys: ['Ctrl', 'K'], join: '+', label: '検索とコマンド' },
      { keys: ['G', '1…9'], join: 'then', label: '上から n 番目のテーブルへ' },
      { keys: ['G', 'H'], join: 'then', label: '今日のタスクへ' },
      { keys: ['M'], label: 'サイドバーを畳む / 開く' },
      { keys: ['?'], label: 'この一覧を開く' },
    ],
  },
  {
    group: 'テーブル',
    items: [
      { keys: ['1…9'], label: 'ビューを切り替える' },
      { keys: ['N'], label: 'レコードを作成' },
      { keys: ['F'], label: 'このテーブルを絞り込む' },
    ],
  },
  {
    group: '一覧',
    items: [
      { keys: ['J', '↓'], join: 'or', label: '次の行へ' },
      { keys: ['K', '↑'], join: 'or', label: '前の行へ' },
      { keys: ['Enter'], label: 'レコードを開く' },
      { keys: ['E'], label: 'タスクを完了にする' },
      { keys: ['Esc'], label: 'パネルを閉じる' },
    ],
  },
]
