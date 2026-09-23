/**
 * Google ドライブの擬似。本番はバックエンドが、ログインしている利用者の Google アカウントで Drive API を叩く(04 §8)。
 * ここでは架空のファイルを数件持ち、「新規」で作ったドキュメントもこの一覧に足す(「参照」で見つかる)。
 */
import { ApiError } from '@/api/client'
import type { DriveFile, GoogleStatus } from '@/api/types'
import { parseDriveFiles } from '@/lib/drive'
import { find, normalizeText, objectMeta, update } from './engine'

const STORAGE_KEY = 'works.mock.drive.v1'
const CONNECTION_KEY = 'works.mock.drive.connection.v1'

/** モックの Google は「繋いだつもり」を localStorage で覚える。本番は利用者ごとの OAuth(04 §8) */
const MOCK_EMAIL = 'takuya@example.jp'

const MIME = {
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
  pdf: 'application/pdf',
}

/** マイドライブに初めからある架空のファイル(会社名は架空) */
const SEED: DriveFile[] = [
  { id: 'drv-0001', name: '提案書テンプレート', mime_type: MIME.presentation, url: 'https://docs.google.com/presentation/d/mock-0001/edit' },
  { id: 'drv-0002', name: '見積書テンプレート', mime_type: MIME.spreadsheet, url: 'https://docs.google.com/spreadsheets/d/mock-0002/edit' },
  { id: 'drv-0003', name: '議事録テンプレート', mime_type: MIME.document, url: 'https://docs.google.com/document/d/mock-0003/edit' },
  { id: 'drv-0004', name: '保守契約書(雛形)', mime_type: MIME.document, url: 'https://docs.google.com/document/d/mock-0004/edit' },
  { id: 'drv-0005', name: '会社案内 2026', mime_type: MIME.pdf, url: 'https://drive.google.com/file/d/mock-0005/view' },
  { id: 'drv-0006', name: '検査データ収集システム 要件定義書', mime_type: MIME.document, url: 'https://docs.google.com/document/d/mock-0006/edit' },
  { id: 'drv-0007', name: '配車管理 移行計画', mime_type: MIME.spreadsheet, url: 'https://docs.google.com/spreadsheets/d/mock-0007/edit' },
  { id: 'drv-0008', name: '展示会 出展レポート', mime_type: MIME.presentation, url: 'https://docs.google.com/presentation/d/mock-0008/edit' },
]

function load(): DriveFile[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved) as DriveFile[]
  } catch {
    // 壊れていたら作り直す
  }
  return structuredClone(SEED)
}

let files: DriveFile[] = load()

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files))
  } catch {
    // 保存できなくても画面は動かす
  }
}

export function resetDrive() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(CONNECTION_KEY)
  files = load()
}

/** 繋いでいるか。モックは初めから繋がっている(画面の流れをそのまま試せるように) */
export function driveStatus(): GoogleStatus {
  const off = localStorage.getItem(CONNECTION_KEY) === 'off'
  return { connected: !off, email: off ? null : MOCK_EMAIL, configured: true }
}

export function connectDrive(): { url: string } {
  localStorage.removeItem(CONNECTION_KEY)
  // 本番は Google の許可の画面。モックは繋いだことにして、同じ画面へ戻す
  return { url: `${location.pathname}?google=connected` }
}

export function disconnectDrive() {
  localStorage.setItem(CONNECTION_KEY, 'off')
}

/** 繋いでいないのにドライブを触ったとき。サーバと同じ符号(409 google_reauth) */
function requireConnected() {
  if (!driveStatus().connected) throw new ApiError(409, 'google_reauth', 'Google に繋いでいません。「Google に接続」から繋いでください')
}

export function listFiles(q: string): DriveFile[] {
  requireConnected()
  const needle = normalizeText(q)
  const hits = needle ? files.filter((f) => normalizeText(f.name).includes(needle)) : files
  return structuredClone(hits.slice(0, 20))
}

/** 「マイドライブ / CRM / テーブル名 / レコード名」のドキュメントを作り、項目の末尾に付ける */
export function createDocument(object: string, id: string, fieldKey: string, me: string | null) {
  requireConnected()
  const meta = objectMeta(object)
  const field = meta.fields.find((f) => f.key === fieldKey)
  if (!field || field.type !== 'drive_files') throw new ApiError(400, 'invalid', 'Google ドライブの項目ではありません')
  const current = find(object, id)
  if (!current) throw new ApiError(404, 'not_found', 'レコードが見つかりません')
  const name = String(current.record[meta.name_field] ?? '') || '名称未設定'
  const seq = files.length + 1
  const doc: DriveFile = {
    id: `drv-${String(seq).padStart(4, '0')}`,
    name,
    mime_type: MIME.document,
    url: `https://docs.google.com/document/d/mock-${String(seq).padStart(4, '0')}/edit`,
  }
  // 本番では、ここで CRM/<テーブル名> のフォルダを探し、無ければ作ってから、その中に置く
  files.unshift(doc)
  save()
  const next = [...parseDriveFiles(current.record[fieldKey]), doc]
  return update(object, id, { [fieldKey]: JSON.stringify(next) }, me)!
}
