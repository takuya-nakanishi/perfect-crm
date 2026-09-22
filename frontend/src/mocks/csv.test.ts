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

  it('IO-061 1 行目にカンマが無くタブがあればタブ区切りで読む(表計算からの貼り付け)', () => {
    // 表計算から貼り付けた形。2 行目以降のカンマはセルの一部として残す
    expect(parseCsv('名前\t金額\tメモ\r\n丸山商事\t1,200\tA, B\r\n"山田\t商店"\t300\t\r\n')).toEqual([
      ['名前', '金額', 'メモ'],
      ['丸山商事', '1,200', 'A, B'],
      ['山田\t商店', '300', ''],
    ])
    // 1 行目にカンマがあればカンマ区切りのまま。タブは文字として残す
    expect(parseCsv('名前,メモ\n丸山\t商事,x\ty')).toEqual([
      ['名前', 'メモ'],
      ['丸山\t商事', 'x\ty'],
    ])
    // 1 行目にカンマもタブも無ければカンマ区切り(1 列)
    expect(parseCsv('名前\n丸山商事')).toEqual([['名前'], ['丸山商事']])
  })
})
