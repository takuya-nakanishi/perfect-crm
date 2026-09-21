import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'

/**
 * 右から出るレコードのパネルは URL の ?peek=テーブル名:ID で開く。
 * 一覧の位置を保ったまま別テーブルのレコードも覗けて、戻るボタンと URL の共有も効く。
 */
export function usePeek() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('peek')

  const peek = useMemo(() => {
    if (!raw) return null
    const i = raw.indexOf(':')
    return i > 0 ? { object: raw.slice(0, i), id: raw.slice(i + 1) } : null
  }, [raw])

  const openPeek = useCallback(
    (object: string, id: string, options?: { replace?: boolean }) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('peek', `${object}:${id}`)
          return next
        },
        { replace: options?.replace ?? Boolean(raw) },
      )
    },
    [setParams, raw],
  )

  const closePeek = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('peek')
        return next
      },
      { replace: true },
    )
  }, [setParams])

  return { peek, openPeek, closePeek }
}
