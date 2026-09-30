import { describe, expect, it } from 'vitest'
import { cleanCode, groupSecret, isCompleteCode } from './code'

describe('2 段階認証の 6 桁', () => {
  it('AUTH-020 全角の数字・空白・ハイフンを整え、6 桁そろったかを見る', () => {
    expect(cleanCode('１２３ ４５６')).toBe('123456')
    expect(cleanCode('123-456')).toBe('123456')
    expect(isCompleteCode('12345')).toBe(false)
    expect(isCompleteCode('１２３４５６')).toBe(true)
    expect(isCompleteCode('1234567')).toBe(false)
  })

  it('AUTH-021 秘密は 4 文字ずつ区切って見せる', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')
    expect(groupSecret('')).toBe('')
  })
})
