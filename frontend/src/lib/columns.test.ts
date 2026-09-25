import { describe, expect, it } from 'vitest'
import { COLUMN_MAX, COLUMN_MIN, columnTemplate, columnWidth, tableMinWidth, withColumnWidth } from './columns'

// テストケース表: docs/tests/records.md。1 つの it が表の 1 行(ID をラベルに入れる)
describe('一覧の列の幅(lib/columns.ts)', () => {
  it('REC-029 columnWidth は無い・数でない幅を既定の 160 に、範囲の外を端に、端数を丸める。withColumnWidth は指した列の幅だけを変える', () => {
    expect(columnWidth(undefined)).toBe(160)
    expect(columnWidth(Number.NaN)).toBe(160)
    expect(columnWidth(Number.POSITIVE_INFINITY)).toBe(160)
    expect(columnWidth('200' as unknown as number)).toBe(160)
    // 境界: 下限と上限はちょうどで通り、外は端に寄せる
    expect(columnWidth(COLUMN_MIN)).toBe(COLUMN_MIN)
    expect(columnWidth(COLUMN_MIN - 1)).toBe(COLUMN_MIN)
    expect(columnWidth(-40)).toBe(COLUMN_MIN)
    expect(columnWidth(COLUMN_MAX)).toBe(COLUMN_MAX)
    expect(columnWidth(COLUMN_MAX + 1)).toBe(COLUMN_MAX)
    expect(columnWidth(133.6)).toBe(134)

    const columns = [{ field: 'name', width: 280 }, { field: 'phone' }, { field: 'email', width: 220 }]
    expect(withColumnWidth(columns, 'phone', 181.4)).toEqual([{ field: 'name', width: 280 }, { field: 'phone', width: 181 }, { field: 'email', width: 220 }])
    // 変えた幅も範囲に揃える。無い列を指したら何も変えない。元の定義は書き換えない
    expect(withColumnWidth(columns, 'name', 5)[0]).toEqual({ field: 'name', width: COLUMN_MIN })
    expect(withColumnWidth(columns, 'bogus', 300)).toEqual(columns)
    expect(columns[1]).toEqual({ field: 'phone' })

    // grid の並びは列ごとの px(スマホ幅の倍率を掛ける)+ 余りを受ける 1 本。合計が表の最小の幅
    expect(columnTemplate([280, 'max-content'])).toBe('calc(280px * var(--col-scale)) max-content minmax(0, 1fr)')
    expect(tableMinWidth([280, 120, 60])).toBe('calc(460px * var(--col-scale))')
  })
})
