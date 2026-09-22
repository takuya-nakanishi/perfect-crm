import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'

// テストケース表: docs/tests/io.md。1 つの it が表の 1 行(ID をラベルに入れる)
describe('CSV の読み取り(mocks/csv.ts)', () => {
  it('IO-060 引用符の中の改行と ""、先頭の BOM、CRLF を扱い、空行は捨てる', () => {
    // 引用符の中の改行はセルの一部、"" は " 1 つ
    expect(parseCsv('名前,メモ\n"山田","1 行目\n2 行目"\n"A ""B"" C",x\n')).toEqual([
      ['名前', 'メモ'],
      ['山田', '1 行目\n2 行目'],
      ['A "B" C', 'x'],
    ])
    // 先頭の BOM は見出しに残さない
    expect(parseCsv('﻿名前,金額\n丸山商事,100')).toEqual([
      ['名前', '金額'],
      ['丸山商事', '100'],
    ])
    // CRLF は 1 つの改行。引用符の中の CRLF は文字のまま残す
    expect(parseCsv('a,b\r\n1,"x\r\ny"\r\n2,3\r\n')).toEqual([
      ['a', 'b'],
      ['1', 'x\r\ny'],
      ['2', '3'],
    ])
    // 空行と、空白やカンマだけの行は捨てる
    expect(parseCsv('a,b\r\n\r\n1,2\n\n , \n,\n3,4\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })
})
