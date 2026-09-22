import { describe, expect, it } from 'vitest'
import type { MetaResponse } from '@/api/types'
import { autoFieldKey, blankDraft, newField, validateDraft } from './tableDraft'

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

  it('META-026 validateDraft は列名の重複・予約語・選択肢の無い選択肢型・参照先の無い参照型を数え、名前の無い新しい行は数えない', () => {
    const meta = { objects: [], views: [], users: [] } as unknown as MetaResponse
    const draft = { ...blankDraft(meta), label: '見積', key: 'quotes' }
    const [name] = draft.fields
    const code = newField(draft.fields, { label: '番号', key: 'code' })
    const reserved = newField(draft.fields, { label: 'ID', key: 'id' })
    const select = newField(draft.fields, { label: '区分', key: 'kind', type: 'select', options: [{ value: 'option_1', label: '  ', color: 'green' }] })
    const relation = newField(draft.fields, { label: '取引先', key: 'account', type: 'relation', target: null })
    const blank = newField(draft.fields, { key: 'field_8' })

    // 不備の無い下書きは 0 件。名前の無い新しい行(選択肢型でも)は数えない
    const blankSelect = newField(draft.fields, { key: 'field_9', type: 'select' })
    expect(validateDraft({ ...draft, fields: [name, code, blank, blankSelect] }, meta)).toEqual({ fields: {}, count: 0 })

    // 4 種の不備を 1 つずつ入れると、行ごとに 1 件ずつ数える
    const errors = validateDraft({ ...draft, fields: [name, code, reserved, select, relation, blank] }, meta)
    expect(errors.fields).toEqual({
      [reserved.uid]: '列名 id はシステムが使っています',
      [select.uid]: '選択肢を 1 つ以上入れてください',
      [relation.uid]: '参照先のテーブルを選んでください',
    })
    expect(errors.count).toBe(3)

    // 列名の重複は、重なった 2 行のどちらにも出る(どちらかを直せば両方消える)
    const dup = newField(draft.fields, { label: 'コード', key: 'code' })
    const withDup = validateDraft({ ...draft, fields: [name, code, reserved, select, relation, blank, dup] }, meta)
    expect(withDup.fields[code.uid]).toBe('列名 code が重なっています')
    expect(withDup.fields[dup.uid]).toBe('列名 code が重なっています')
    expect(withDup.fields[blank.uid]).toBeUndefined()
    expect(withDup.count).toBe(5)

    // 名前の無い新しい行が、既にある列名と重なっていても数えない
    const blankDup = newField(draft.fields, { key: 'code' })
    expect(validateDraft({ ...draft, fields: [name, code, blankDup] }, meta).count).toBe(0)
  })
})
