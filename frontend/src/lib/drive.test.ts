import { describe, expect, it } from 'vitest'
import type { DriveFile } from '@/api/types'
import { driveKind, parseDriveFiles } from './drive'

// テストケース表: docs/tests/io.md。1 つの it が表の 1 行(ID をラベルに入れる)
const doc: DriveFile = { id: 'f1', name: '提案書', mime_type: 'application/vnd.google-apps.document', url: 'https://docs.google.com/document/d/f1' }
const pdf: DriveFile = { id: 'f2', name: '見積書.pdf', mime_type: 'application/pdf', url: 'https://drive.google.com/file/d/f2' }

describe('Google ドライブの項目(lib/drive.ts)', () => {
  it('IO-086 parseDriveFiles は id と url の無い要素と壊れた JSON を捨て、driveKind は MIME から種類を決める', () => {
    // 配列はそのまま順に読む
    expect(parseDriveFiles(JSON.stringify([doc, pdf]))).toEqual([doc, pdf])
    // id か url が無い・文字列でない要素と、null は捨てる
    const mixed = [doc, { name: 'id 無し', mime_type: 'application/pdf', url: 'https://example.com/a' }, { id: 'f3', name: 'url 無し', mime_type: 'application/pdf' }, { id: 4, url: 'https://example.com/b' }, null, pdf]
    expect(parseDriveFiles(JSON.stringify(mixed))).toEqual([doc, pdf])
    // 壊れた JSON・配列でない JSON・空・文字列でない値は空
    expect(parseDriveFiles('[{"id":"f1",')).toEqual([])
    expect(parseDriveFiles(JSON.stringify(doc))).toEqual([])
    expect(parseDriveFiles('')).toEqual([])
    expect(parseDriveFiles(null)).toEqual([])
    expect(parseDriveFiles(undefined)).toEqual([])
    expect(parseDriveFiles(12)).toEqual([])

    expect(driveKind('application/vnd.google-apps.document').label).toBe('ドキュメント')
    expect(driveKind('application/vnd.google-apps.spreadsheet').label).toBe('スプレッドシート')
    expect(driveKind('application/vnd.google-apps.presentation').label).toBe('スライド')
    expect(driveKind('application/pdf').label).toBe('PDF')
    expect(driveKind('image/png').label).toBe('ファイル')
    expect(driveKind('').label).toBe('ファイル')
  })
})
