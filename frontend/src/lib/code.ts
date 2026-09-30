/**
 * 2 段階認証(TOTP)の 6 桁と秘密の見せ方(05 §15)。
 * 全角の数字は半角へ、空白やハイフンは捨てる(サーバの app/auth/totp.py の clean と同じ)。
 * 打っている最中の値は書き換えない(送るときにだけ整える。runbook §4)
 */
export function cleanCode(code: string): string {
  return code.normalize('NFKC').replace(/\D/g, '')
}

/** 6 桁そろったか(そろったら押さなくても送る) */
export function isCompleteCode(code: string): boolean {
  return cleanCode(code).length === 6
}

/** base32 の秘密を 4 文字ずつ区切る(認証アプリに手で打ち込むとき読みやすいように) */
export function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ')
}
