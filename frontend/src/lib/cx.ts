/** クラス名をつなぐ。falsy は捨てる */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
