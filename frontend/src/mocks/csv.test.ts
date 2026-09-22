import { beforeEach, describe, expect, it } from 'vitest'
import type { FieldMeta } from '@/api/types'
import { coerce, importCsv, parseCsv } from './csv'
import { resetTables, table, users } from './engine'

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

describe('CSV の取り込み(mocks/csv.ts)', () => {
  beforeEach(() => resetTables())

  it('IO-062 mapping を省くと見出しを項目名(正規化)と列名から推測し、同じ項目に 2 列は当てない(先の列が勝つ)', () => {
    const csv = [
      ' 取引先名 ,ＷＥＢ　サイト,ふりがな,PHONE,employees,電話,業種,industry,created_at,備考',
      '丸山商事,https://example.com,マルヤマショウジ,03-1111-2222,12,06-9999-0000,製造,IT,2026-01-01,x',
    ].join('\n')
    const res = importCsv('accounts', { csv }, users[0].id)
    expect(res.mapping).toEqual({
      // 項目名は NFKC・小文字・ひらがな→カタカナ・空白除去で比べる
      ' 取引先名 ': 'name',
      'ＷＥＢ　サイト': 'website',
      'ふりがな': 'name_kana',
      // 列名(大文字小文字は問わない)
      PHONE: 'phone',
      employees: 'employees',
      // 先に phone・industry へ当たった列が勝ち、後の列は当てない
      電話: null,
      業種: 'industry',
      industry: null,
      // 読み取り専用の項目と、知らない見出しは当てない
      created_at: null,
      備考: null,
    })
    // 作った行も、先の列の値を持つ(後の列の値で上書きしない)
    expect(res.errors).toEqual([])
    const created = table('accounts').find((r) => r.id === res.created_ids[0])
    expect(created).toMatchObject({ name: '丸山商事', website: 'https://example.com', name_kana: 'マルヤマショウジ', phone: '03-1111-2222', employees: 12 })
  })

  it('IO-063 読めない行(必須が空・無い選択肢・数値でない)は errors に行番号と理由を残して飛ばし、読める行だけ作る。dry_run は作らない', () => {
    const csv = [
      '取引先名,業種,従業員数',
      '丸山商事,製造,12',
      ',製造,5',
      '山田商店,宇宙,5',
      '川口工業,IT・通信,たくさん',
      '森田物産,,7',
    ].join('\n')
    const expectedErrors = [
      // 行番号は見出しを 1 行目と数えた CSV の行
      { line: 3, message: '取引先名が空です' },
      { line: 4, message: '業種に「宇宙」という選択肢はありません' },
      { line: 5, message: '従業員数「たくさん」は数値ではありません' },
    ]

    // dry_run は検証だけ。件数とエラーは本番と同じで、レコードは作らない
    const before = table('accounts').length
    const dry = importCsv('accounts', { csv, dry_run: true }, users[0].id)
    expect(dry).toMatchObject({ total: 5, valid: 2, errors: expectedErrors, created_ids: [] })
    expect(table('accounts')).toHaveLength(before)

    // 本番は読める行だけ作り、読めない行は飛ばす
    const res = importCsv('accounts', { csv }, users[0].id)
    expect(res).toMatchObject({ total: 5, valid: 2, errors: expectedErrors })
    expect(res.created_ids).toHaveLength(2)
    expect(table('accounts')).toHaveLength(before + 2)
    const created = res.created_ids.map((id) => table('accounts').find((r) => r.id === id))
    expect(created).toMatchObject([
      { name: '丸山商事', industry: 'manufacturing', employees: 12 },
      { name: '森田物産', employees: 7 },
    ])
    for (const name of ['山田商店', '川口工業']) expect(table('accounts').some((r) => r.name === name)).toBe(false)
  })
})

describe('文字から値への変換(mocks/csv.ts の coerce)', () => {
  it('IO-064 数値は全角・カンマ・円記号、日付は / と年月日、選択肢はラベルか値、利用者は名前かメール、チェックは「はい / true / 1 / ○」を受ける', () => {
    const amount: FieldMeta = { key: 'amount', label: '金額', type: 'currency' }
    const count: FieldMeta = { key: 'count', label: '人数', type: 'number' }
    // 全角の数字、桁区切りのカンマ、円記号(¥ と「円」)を受ける
    expect(coerce(count, '１２３')).toBe(123)
    expect(coerce(amount, '1,200,000')).toBe(1200000)
    expect(coerce(amount, '¥1,200')).toBe(1200)
    expect(coerce(amount, '￥３，４００')).toBe(3400)
    expect(coerce(amount, '5,000円')).toBe(5000)
    expect(() => coerce(amount, '千円')).toThrow('数値ではありません')

    const due: FieldMeta = { key: 'due', label: '期日', type: 'date' }
    // 区切りが / でも年月日でも、1 桁の月日は 0 で埋めた ISO の日付にする
    expect(coerce(due, '2026-09-30')).toBe('2026-09-30')
    expect(coerce(due, '2026/9/30')).toBe('2026-09-30')
    expect(coerce(due, '2026年9月30日')).toBe('2026-09-30')
    expect(coerce(due, '２０２６年９月３日')).toBe('2026-09-03')
    expect(() => coerce(due, '9月30日')).toThrow('日付として読めません')

    const rank: FieldMeta = {
      key: 'rank',
      label: '確度',
      type: 'select',
      options: [
        { value: 'hot', label: '高い', color: 'green' },
        { value: 'cold', label: '低い', color: 'gray' },
      ],
    }
    // ラベルでも値でも、保存するのは値
    expect(coerce(rank, '高い')).toBe('hot')
    expect(coerce(rank, 'cold')).toBe('cold')
    expect(() => coerce(rank, '普通')).toThrow('という選択肢はありません')

    const owner: FieldMeta = { key: 'owner', label: '担当', type: 'user' }
    const [first, second] = users
    // 名前でもメール(大文字小文字は問わない)でも、保存するのは利用者の ID
    expect(coerce(owner, first.name)).toBe(first.id)
    expect(coerce(owner, second.email)).toBe(second.id)
    expect(coerce(owner, second.email.toUpperCase())).toBe(second.id)
    expect(() => coerce(owner, 'nobody@example.jp')).toThrow('という利用者はいません')

    const done: FieldMeta = { key: 'done', label: '完了', type: 'checkbox' }
    for (const yes of ['はい', 'true', 'TRUE', '1', '○']) expect(coerce(done, yes), yes).toBe(true)
    for (const no of ['いいえ', 'false', '0', '×']) expect(coerce(done, no), no).toBe(false)
    // 空は型によらず null(値なし)
    expect(coerce(done, '  ')).toBeNull()
    expect(coerce(amount, '')).toBeNull()
  })
})
