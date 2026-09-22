import { beforeEach, describe, expect, it } from 'vitest'
import type { FieldMeta } from '@/api/types'
import { coerce, exportCsv, importCsv, parseCsv } from './csv'
import { insert, objectMeta, query, resetTables, table, users } from './engine'

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

  it('IO-067 created_ids は CSV の並びと同じ順で、一覧でも上から同じ順に見える', () => {
    // 途中に読めない行を挟んでも、残りの並びは崩さない
    const csv = ['取引先名,従業員数', '一番商事,1', '二番物産,2', '読めない,たくさん', '三番工業,3', '四番商店,4'].join('\n')
    const res = importCsv('accounts', { csv }, users[0].id)
    expect(res.errors).toHaveLength(1)
    const names = res.created_ids.map((id) => table('accounts').find((r) => r.id === id)?.name)
    expect(names).toEqual(['一番商事', '二番物産', '三番工業', '四番商店'])

    // 並べ替えなしの一覧も、新しい順(作成日時の降順)の一覧も、上から CSV と同じ順
    const plain = query('accounts', { limit: 4 }, users[0].id)
    expect(plain.records.map((r) => r.id)).toEqual(res.created_ids)
    const newest = query('accounts', { sort: [{ field: 'created_at', dir: 'desc' }], limit: 4 }, users[0].id)
    expect(newest.records.map((r) => r.id)).toEqual(res.created_ids)
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

  it('IO-066 複数選択は「営業、事務」を値の配列にし、無いラベルはエラーにし、重複は 1 つにする', () => {
    const tags: FieldMeta = {
      key: 'tags',
      label: '部署',
      type: 'multi_select',
      options: [
        { value: 'sales', label: '営業', color: 'blue' },
        { value: 'office', label: '事務', color: 'gray' },
        { value: 'dev', label: '開発', color: 'green' },
      ],
    }
    // 読点で区切ったラベルを、値の配列(JSON)にする。前後の空白は無視
    expect(JSON.parse(String(coerce(tags, '営業、事務')))).toEqual(['sales', 'office'])
    expect(JSON.parse(String(coerce(tags, ' 営業 、 開発 ')))).toEqual(['sales', 'dev'])
    // カンマ区切りでも、値で書いても同じ
    expect(JSON.parse(String(coerce(tags, 'sales,事務')))).toEqual(['sales', 'office'])
    // 1 つでも無いラベルがあれば、行ごとエラーにする(黙って落とさない)
    expect(() => coerce(tags, '営業、経理')).toThrow('部署に「経理」という選択肢はありません')
    // ラベルと値で同じ選択肢を 2 回書いても 1 つ
    expect(JSON.parse(String(coerce(tags, '営業、営業、sales、事務')))).toEqual(['sales', 'office'])
  })
})

describe('参照の解決(mocks/csv.ts の coerce)', () => {
  beforeEach(() => resetTables())

  it('IO-065 参照は表示名が一致する 1 件なら結び、同名が 2 件以上ならエラーにし(黙って選ばない)、UUID ならそのまま結ぶ', () => {
    const account: FieldMeta = { key: 'account_id', label: '取引先', type: 'relation', target: 'accounts' }
    const rows = table('accounts')
    const unique = rows.find((r) => rows.filter((o) => o.name === r.name).length === 1)!
    const other = rows.find((r) => r.id !== unique.id)!

    // 表示名が 1 件だけ一致すれば、その ID を結ぶ(前後の空白は無視)
    expect(coerce(account, String(unique.name))).toBe(unique.id)
    expect(coerce(account, ` ${String(unique.name)} `)).toBe(unique.id)
    expect(() => coerce(account, 'どこにもない商事')).toThrow('が見つかりません')

    // 同名がもう 1 件できたら、どちらも選ばずにエラーにする
    rows.push({ ...other, id: '00000000-0000-4000-8000-000000000065', name: unique.name })
    expect(() => coerce(account, String(unique.name))).toThrow('が 2 件あります。ID で指定してください')

    // UUID なら名前が重なっていてもその行を結ぶ
    expect(coerce(account, unique.id)).toBe(unique.id)
    expect(coerce(account, '00000000-0000-4000-8000-000000000065')).toBe('00000000-0000-4000-8000-000000000065')
    expect(coerce(account, other.id)).toBe(other.id)
  })
})

describe('CSV の書き出し(mocks/csv.ts)', () => {
  beforeEach(() => resetTables())

  // Blob.text() は先頭の BOM を黙って捨てるので、バイト列で読む
  async function read(blob: Blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
    return { bytes, text, rows: parseCsv(text) }
  }

  it('IO-068 先頭に BOM、見出しは項目名、選択肢はラベル、参照と利用者は表示名、複数選択は「営業、事務」、richtext は書式を落とした文字、ドライブは名前と URL', async () => {
    const me = users[0].id
    const contact = table('contacts')[0]
    const files = [
      { id: 'f1', name: '提案書', mime_type: 'application/vnd.google-apps.document', url: 'https://docs.google.com/document/d/f1' },
      { id: 'f2', name: '見積書.pdf', mime_type: 'application/pdf', url: 'https://drive.google.com/file/d/f2' },
    ]
    insert(
      'tasks',
      {
        title: '書き出し確認のタスク',
        status: 'in_progress',
        labels: JSON.stringify(['sales', 'admin']),
        contact_id: contact.id,
        assignee_id: users[1].id,
        documents: JSON.stringify(files),
      },
      me,
    )

    const tasks = await read(exportCsv('tasks', { q: '書き出し確認のタスク' }, me))
    // Excel が UTF-8 として開くための BOM(EF BB BF)
    expect([...tasks.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(tasks.text.startsWith('\uFEFF')).toBe(true)
    // 見出しは列名でなく項目名。取り込み(parseCsv)も BOM を見出しに残さない
    const header = tasks.rows[0]
    expect(header).toEqual(objectMeta('tasks').fields.map((f) => f.label))
    expect(header).not.toContain('title')
    expect(tasks.rows).toHaveLength(2)
    const cell = (label: string) => tasks.rows[1][header.indexOf(label)]
    expect(cell('件名')).toBe('書き出し確認のタスク')
    // 選択肢は値(in_progress)でなくラベル
    expect(cell('状況')).toBe('進行中')
    // 複数選択はラベルを「、」でつなぐ
    expect(cell('ラベル')).toBe('営業、事務')
    // 参照と利用者は UUID でなく表示名
    expect(cell('取引先責任者')).toBe(String(contact.name))
    expect(cell('担当')).toBe(users[1].name)
    // ドライブは 1 ファイル 1 行で「名前 URL」
    expect(cell('資料')).toBe('提案書 https://docs.google.com/document/d/f1\n見積書.pdf https://drive.google.com/file/d/f2')

    insert(
      'activities',
      {
        subject: '書き出し確認の活動',
        type: 'call',
        body: '<p><strong>決定</strong>: 来週 &amp; 再訪</p><ul><li>見積 &lt;改&gt;</li><li>日程</li></ul>',
      },
      me,
    )
    const activities = await read(exportCsv('activities', { q: '書き出し確認の活動' }, me))
    expect([...activities.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const aHeader = activities.rows[0]
    expect(aHeader).toEqual(objectMeta('activities').fields.map((f) => f.label))
    const aCell = (label: string) => activities.rows[1][aHeader.indexOf(label)]
    expect(aCell('種別')).toBe('電話')
    expect(aCell('記録者')).toBe(users[0].name)
    // richtext はタグを落とし、段落と項目は改行、文字参照は元の文字に戻す
    expect(aCell('内容')).toBe('決定: 来週 & 再訪\n見積 <改>\n日程')
  })
})
