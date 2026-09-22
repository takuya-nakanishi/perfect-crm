import { createContext, useCallback, useContext, useMemo } from 'react'
import { useSearchParams } from 'react-router'

export interface PeekRef {
  object: string
  id: string
}

/**
 * レコードのパネルの中か。中から開いたレコードは、いまの経路の続きに積む(ぱんくずになる)。
 * 外(一覧・カンバン・検索)から開いたレコードは、経路をそこから始め直す
 */
export const PanelScope = createContext(false)

function parse(raw: string | null): PeekRef[] {
  if (!raw) return []
  return raw.split(',').flatMap((part) => {
    const i = part.indexOf(':')
    return i > 0 && i < part.length - 1 ? [{ object: part.slice(0, i), id: part.slice(i + 1) }] : []
  })
}

const format = (trail: PeekRef[]) => trail.map((t) => `${t.object}:${t.id}`).join(',')

/**
 * 右から出るレコードのパネルは URL の ?peek= で開く。値は「テーブル名:ID」をカンマでつないだ経路で、
 * 末尾がいま開いているレコード、その手前がたどってきたレコード(取引先 → 取引先責任者 → 商談)。
 * 一覧の位置を保ったまま別テーブルのレコードも覗けて、戻るボタンと URL の共有も効く。
 */
export function usePeek() {
  const [params, setParams] = useSearchParams()
  const inPanel = useContext(PanelScope)
  const raw = params.get('peek')
  const trail = useMemo(() => parse(raw), [raw])
  const peek = trail.at(-1) ?? null
  const root = trail[0] ?? null

  const write = useCallback(
    (next: (trail: PeekRef[]) => PeekRef[], replace: boolean) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev)
          const value = format(next(parse(prev.get('peek'))))
          if (value) out.set('peek', value)
          else out.delete('peek')
          return out
        },
        { replace },
      )
    },
    [setParams],
  )

  const openPeek = useCallback(
    (object: string, id: string, options?: { replace?: boolean }) => {
      if (inPanel) {
        // 経路に既にあるレコードなら、そこまで戻る(取引先 → 責任者 → 同じ取引先、で堂々巡りにしない)
        write((current) => {
          const at = current.findIndex((t) => t.object === object && t.id === id)
          return at >= 0 ? current.slice(0, at + 1) : [...current, { object, id }]
        }, options?.replace ?? false)
        return
      }
      write(() => [{ object, id }], options?.replace ?? Boolean(raw))
    },
    [write, inPanel, raw],
  )

  /** 経路の index 番目まで戻る */
  const goTo = useCallback((index: number) => write((current) => current.slice(0, index + 1), false), [write])

  const closePeek = useCallback(() => write(() => [], true), [write])

  /** 1 つ前のレコードへ。経路が 1 件ならパネルを閉じる */
  const back = useCallback(() => {
    if (trail.length > 1) goTo(trail.length - 2)
    else closePeek()
  }, [trail.length, goTo, closePeek])

  return { peek, root, trail, openPeek, goTo, back, closePeek }
}
