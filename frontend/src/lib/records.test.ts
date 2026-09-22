import { describe, expect, it } from 'vitest'
import type { FieldMeta, References, Row } from '@/api/types'
import { refFor } from './records'

// テストケース表: docs/tests/records.md。1 つの it が表の 1 行(ID をラベルに入れる)
const row = (v: Partial<Row>): Row => ({ id: 'r', ...v })

describe('参照先の解決(lib/records.ts)', () => {
  it('REC-047 refFor: relation は target と値、user は users、polymorphic は 2 列から。表示名が無ければ … で成立させる', () => {
    const relation: FieldMeta = { key: 'account_id', label: '取引先', type: 'relation', target: 'accounts' }
    const user: FieldMeta = { key: 'owner_id', label: '担当者', type: 'user' }
    const poly: FieldMeta = {
      key: 'related',
      label: '関連先',
      type: 'polymorphic',
      targets: ['accounts', 'deals'],
      columns: { object: 'related_object', id: 'related_id' },
    }
    const refs: References = {
      accounts: { a1: { id: 'a1', name: '架空商事', subtitle: '東京' } },
      users: { u1: { id: 'u1', name: '山田 太郎' } },
      deals: { d1: { id: 'd1', name: '導入案件' } },
    }

    // relation: テーブルは target、ID は列の値
    expect(refFor(relation, row({ account_id: 'a1' }), refs)).toEqual({
      object: 'accounts',
      ref: { id: 'a1', name: '架空商事', subtitle: '東京' },
    })
    // user: テーブルは常に users
    expect(refFor(user, row({ owner_id: 'u1' }), refs)).toEqual({ object: 'users', ref: { id: 'u1', name: '山田 太郎' } })
    // polymorphic: テーブル名の列と ID の列の 2 つから(key の列は見ない)
    expect(refFor(poly, row({ related_object: 'deals', related_id: 'd1', related: 'x' }), refs)).toEqual({
      object: 'deals',
      ref: { id: 'd1', name: '導入案件' },
    })

    // 表示名がまだ届いていなくても、リンクとしては成立させる(名前は …)
    expect(refFor(relation, row({ account_id: 'a9' }), refs)).toEqual({ object: 'accounts', ref: { id: 'a9', name: '…' } })
    expect(refFor(user, row({ owner_id: 'u9' }), {})).toEqual({ object: 'users', ref: { id: 'u9', name: '…' } })
    expect(refFor(poly, row({ related_object: 'deals', related_id: 'd9' }), refs)).toEqual({
      object: 'deals',
      ref: { id: 'd9', name: '…' },
    })

    // 指していなければ null(値が空、polymorphic のテーブル名が空、参照型でない列)
    expect(refFor(relation, row({ account_id: null }), refs)).toBeNull()
    expect(refFor(user, row({}), refs)).toBeNull()
    expect(refFor(poly, row({ related_object: null, related_id: 'd1' }), refs)).toBeNull()
    expect(refFor(poly, row({ related_object: 'deals', related_id: null }), refs)).toBeNull()
    expect(refFor({ key: 'name', label: '名前', type: 'text' }, row({ name: 'a1' }), refs)).toBeNull()
  })
})
