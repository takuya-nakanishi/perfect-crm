import { useEffect, useState } from 'react'

/** 値の変化が ms だけ落ち着いてから反映する(打鍵ごとに検索を投げないため) */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}
