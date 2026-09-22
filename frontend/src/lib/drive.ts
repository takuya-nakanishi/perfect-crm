import { FileSpreadsheet, FileText, File as FileIcon, Presentation, type LucideIcon } from 'lucide-react'
import type { DriveFile, Scalar } from '@/api/types'

/** drive_files 型の値(JSON 文字列)を読む。壊れていれば空 */
export function parseDriveFiles(value: Scalar | undefined): DriveFile[] {
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as DriveFile[]).filter((f) => f && typeof f.id === 'string' && typeof f.url === 'string') : []
  } catch {
    return []
  }
}

/** MIME → 種類の名前と印(Google の 3 種と、それ以外) */
export function driveKind(mime: string): { label: string; icon: LucideIcon; color: string } {
  if (mime === 'application/vnd.google-apps.document') return { label: 'ドキュメント', icon: FileText, color: 'blue' }
  if (mime === 'application/vnd.google-apps.spreadsheet') return { label: 'スプレッドシート', icon: FileSpreadsheet, color: 'green' }
  if (mime === 'application/vnd.google-apps.presentation') return { label: 'スライド', icon: Presentation, color: 'amber' }
  if (mime === 'application/pdf') return { label: 'PDF', icon: FileIcon, color: 'red' }
  return { label: 'ファイル', icon: FileIcon, color: 'gray' }
}
