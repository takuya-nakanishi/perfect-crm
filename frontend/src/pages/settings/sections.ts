import { Cable, Globe, Table2, type LucideIcon } from 'lucide-react'

/** 環境設定の節。左の一覧の並び */
export const SETTINGS_SECTIONS: { path: string; label: string; hint: string; icon: LucideIcon }[] = [
  { path: 'tables', label: 'テーブル', hint: '項目の定義、サイドバーに出すか、並び', icon: Table2 },
  { path: 'forms', label: 'Web フォーム', hint: 'Web サイトから直接レコードを受け付ける', icon: Globe },
  { path: 'mcp', label: 'MCP', hint: 'Claude などの AI アプリから繋ぐ', icon: Cable },
]

