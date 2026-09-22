import { describe, expect, it } from 'vitest'
import { autoFieldKey, newField } from './tableDraft'

// テストケース表: docs/tests/meta.md。1 つの it が表の 1 行(ID をラベルに入れる)

describe('テーブル設定の下書き(lib/tableDraft.ts)', () => {
  it('META-025 autoFieldKey は英字の名前から列名を作り、和文は field_1・field_2 と連番にし、既にある列名は避ける', () => {
    const name = newField([], { label: '名前', key: 'name' })

    // 英字の名前 → 小文字とアンダースコア
    const lead = newField([name], { label: 'Lead Source' })
    expect(lead.key).toBe('lead_source')
    expect(autoFieldKey('Lead Source', [name, lead], lead)).toBe('lead_source')

    // 和文 → 連番。2 つめは次の番号
    const quote = newField([name, lead], { label: '見積番号' })
    expect(quote.key).toBe('field_1')
    const second = newField([name, lead, quote], { label: '見積日' })
    expect(second.key).toBe('field_2')
    // いちど付けた連番は、名前を打ち直しても変わらない
    expect(autoFieldKey('見積番号(税込)', [name, lead, quote, second], quote)).toBe('field_1')

    // 既にある列名は避ける(まだ列名の無い欄で確かめる)
    const other = { ...newField([name, lead, quote, second]), key: '' }
    const fields = [name, lead, quote, second, other]
    expect(autoFieldKey('Lead Source', fields, other)).toBe('lead_source_1')
    expect(autoFieldKey('Name', fields, other)).toBe('name_1')
    expect(autoFieldKey('ID', fields, other)).toBe('id_1')
    expect(autoFieldKey('受注日', fields, other)).toBe('field_3')
  })
})
