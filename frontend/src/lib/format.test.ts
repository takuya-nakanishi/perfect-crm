import { describe, expect, it } from 'vitest'
import { formatNumber, formatPercent, formatYen, formatYenCompact } from './format'

// テストケース表: docs/tests/io.md。1 つの it が表の 1 行(ID をラベルに入れる)
describe('金額の書式(lib/format.ts)', () => {
  it('IO-080 formatYen は半角の ¥ と 3 桁区切り、formatYenCompact は 億円 / 万円 / ¥ で出す', () => {
    expect(formatYen(1_200_000)).toBe('¥1,200,000')
    // 全角の円記号(U+FFE5)ではなく半角(U+00A5)
    expect(formatYen(1_200_000).charCodeAt(0)).toBe(0x00a5)
    expect(formatYen(1_200_000)).not.toContain('￥')

    expect(formatYenCompact(120_000_000)).toBe('1.2億円')
    expect(formatYenCompact(12_400_000)).toBe('1,240万円')
    expect(formatYenCompact(9_800)).toBe('¥9,800')
  })
})

describe('数値と割合の書式(lib/format.ts)', () => {
  it('IO-081 formatNumber と formatPercent は scale の桁で揃え、scale: 0 も無視せず整数に丸める', () => {
    expect(formatNumber(12.54)).toBe('13')
    expect(formatNumber(12.54, 2)).toBe('12.54')
    expect(formatNumber(12.54, 0)).toBe('13')

    expect(formatPercent(12.54)).toBe('12.5%')
    expect(formatPercent(12.54, 2)).toBe('12.54%')
    // 0 は「指定なし」ではない。最大 1 桁(12.5%)に落ちず、整数に丸める
    expect(formatPercent(12.54, 0)).toBe('13%')
  })
})
