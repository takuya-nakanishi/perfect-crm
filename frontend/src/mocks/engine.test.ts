import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import type { ObjectInput } from '@/api/types'
import { createObject, getMeta, resetTables } from './engine'

// テストケース表: docs/tests/meta.md。1 つの it が表の 1 行(ID をラベルに入れる)
const input = (key: string): ObjectInput => ({
  key,
  label: '試しのテーブル',
  icon: 'box',
  color: 'blue',
  fields: [{ key: 'name', label: '名前', type: 'text' }],
})

/** 呼んだ結果の ApiError の status(投げなければ null) */
function statusOf(fn: () => unknown): number | null {
  try {
    fn()
    return null
  } catch (e) {
    if (e instanceof ApiError) return e.status
    throw e
  }
}

describe('テーブル設定(mocks/engine.ts)', () => {
  beforeEach(() => resetTables())

  it('META-004 列名が規則外(大文字・先頭が数字・40 文字超)のテーブルは 400', () => {
    for (const key of ['Deals', 'deal_X', '1deals', '_deals', 'a'.repeat(41)]) {
      expect(statusOf(() => createObject(input(key))), key).toBe(400)
      expect(getMeta().objects.some((o) => o.key === key), key).toBe(false)
    }
    // 境界: 40 文字ちょうどは作れる
    const ok = 'a'.repeat(40)
    expect(statusOf(() => createObject(input(ok)))).toBeNull()
    expect(getMeta().objects.some((o) => o.key === ok)).toBe(true)
  })

  it('META-005 列名が予約語(users・meta・session・search)のテーブルは 400', () => {
    for (const key of ['users', 'meta', 'session', 'search']) {
      const before = getMeta().objects.length
      expect(statusOf(() => createObject(input(key))), key).toBe(400)
      expect(getMeta().objects.length, key).toBe(before)
    }
    // 予約語を含むだけの列名は作れる(完全一致だけを弾く)
    expect(statusOf(() => createObject(input('users_extra')))).toBeNull()
  })

  it('META-006 先頭の項目が文字(1 行)でないテーブルは 400。文字なら name_field になり必須が付く', () => {
    for (const type of ['textarea', 'richtext', 'number', 'email', 'date'] as const) {
      const key = `first_${type}`
      const body = { ...input(key), fields: [{ key: 'body', label: '本文', type }, { key: 'name', label: '名前', type: 'text' as const }] }
      expect(statusOf(() => createObject(body)), type).toBe(400)
      expect(getMeta().objects.some((o) => o.key === key), type).toBe(false)
    }
    // 文字なら作れて、先頭の項目が表示名になり、required を付けずに送っても必須になる
    const body = { ...input('first_text'), fields: [{ key: 'title', label: '件名', type: 'text' as const }, { key: 'memo', label: 'メモ', type: 'textarea' as const }] }
    expect(statusOf(() => createObject(body))).toBeNull()
    const made = getMeta().objects.find((o) => o.key === 'first_text')
    expect(made?.name_field).toBe('title')
    expect(made?.fields.find((f) => f.key === 'title')?.required).toBe(true)
    expect(made?.fields.find((f) => f.key === 'memo')?.required).toBeFalsy()
  })

  it('META-007 項目の列名が id・created_at・updated_at なら 400。同じ列名が 2 つでも 400', () => {
    for (const key of ['id', 'created_at', 'updated_at']) {
      const table = `sys_${key}`
      const body = { ...input(table), fields: [{ key: 'name', label: '名前', type: 'text' as const }, { key, label: '予約', type: 'text' as const }] }
      expect(statusOf(() => createObject(body)), key).toBe(400)
      expect(getMeta().objects.some((o) => o.key === table), key).toBe(false)
    }
    // 同じ列名が 2 つ(型が違っても)
    const dup = { ...input('dup_fields'), fields: [{ key: 'name', label: '名前', type: 'text' as const }, { key: 'memo', label: 'メモ', type: 'text' as const }, { key: 'memo', label: 'メモ 2', type: 'textarea' as const }] }
    expect(statusOf(() => createObject(dup))).toBe(400)
    expect(getMeta().objects.some((o) => o.key === 'dup_fields')).toBe(false)
    // 予約語を含むだけの列名や、別々の列名なら作れる
    const ok = { ...input('ok_fields'), fields: [{ key: 'name', label: '名前', type: 'text' as const }, { key: 'external_id', label: '外部 ID', type: 'text' as const }, { key: 'created_at_origin', label: '元の作成日', type: 'date' as const }] }
    expect(statusOf(() => createObject(ok))).toBeNull()
    expect(getMeta().objects.some((o) => o.key === 'ok_fields')).toBe(true)
  })
})
