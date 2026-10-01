import type { LoginProvider } from '@/api/types'
import googleMark from '@/assets/brands/google.svg'
import microsoftMark from '@/assets/brands/microsoft.svg'

const MARKS: Record<LoginProvider, string> = { google: googleMark, microsoft: microsoftMark }

/**
 * 提供元のマーク(05 §15)。色と形は各社の手引きのまま(`assets/brands/README.md`)。
 * Google の G は白い地に置く決まりなので、暗いテーマでも白い角丸を敷く(Microsoft も並びを揃えて同じ地に置く)
 */
export function ProviderMark({ provider, size = 18 }: { provider: LoginProvider; size?: number }) {
  return (
    <span aria-hidden className="grid flex-none place-items-center rounded-[5px] bg-white" style={{ width: size + 6, height: size + 6 }}>
      <img src={MARKS[provider]} alt="" width={size} height={size} />
    </span>
  )
}
