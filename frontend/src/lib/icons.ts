import {
  Activity,
  AlignLeft,
  Banknote,
  BookOpen,
  Box,
  Briefcase,
  Building2,
  Calendar,
  CalendarClock,
  ChartColumn,
  CircleCheck,
  ClipboardList,
  ContactRound,
  Factory,
  FileText,
  Flag,
  Folder,
  Handshake,
  Hash,
  JapaneseYen,
  Lightbulb,
  Link,
  ListChecks,
  Mail,
  MapPin,
  Package,
  Paperclip,
  Percent,
  Phone,
  Receipt,
  Rows3,
  ShoppingCart,
  Spline,
  SquareCheck,
  SquareKanban,
  Star,
  Store,
  Table2,
  Tag,
  Tags,
  TextQuote,
  Ticket,
  Truck,
  Type,
  User,
  Users,
  Waypoints,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { FieldType, ViewType } from '@/api/types'

/** メタデータのアイコン名 → コンポーネント。使うものだけ載せる(全部を束ねると重くなる) */
const OBJECT_ICONS: Record<string, LucideIcon> = {
  'building-2': Building2,
  'contact-round': ContactRound,
  handshake: Handshake,
  'circle-check': CircleCheck,
  activity: Activity,
  'table-2': Table2,
  box: Box,
  package: Package,
  'file-text': FileText,
  folder: Folder,
  'clipboard-list': ClipboardList,
  briefcase: Briefcase,
  users: Users,
  user: User,
  calendar: Calendar,
  receipt: Receipt,
  banknote: Banknote,
  'shopping-cart': ShoppingCart,
  store: Store,
  factory: Factory,
  truck: Truck,
  wrench: Wrench,
  ticket: Ticket,
  tag: Tag,
  star: Star,
  flag: Flag,
  'map-pin': MapPin,
  'book-open': BookOpen,
  lightbulb: Lightbulb,
}

/** テーブル設定で選べるアイコン(並びは選ぶ画面の並び) */
export const OBJECT_ICON_NAMES = Object.keys(OBJECT_ICONS).filter((name) => name !== 'circle-check' && name !== 'activity')

export function objectIcon(name: string): LucideIcon {
  return OBJECT_ICONS[name] ?? Table2
}

export const VIEW_ICONS: Record<ViewType, LucideIcon> = {
  list: Rows3,
  kanban: SquareKanban,
  report: ChartColumn,
}

/** 項目の型の呼び名とアイコン。テーブル設定で使う。並びは選ぶ画面の並び */
export const FIELD_TYPES: { type: FieldType; label: string; hint: string; icon: LucideIcon }[] = [
  { type: 'text', label: '文字(1 行)', hint: '名前、番号、短いメモ', icon: Type },
  { type: 'textarea', label: '文字(複数行)', hint: '長いメモ、経緯', icon: AlignLeft },
  { type: 'richtext', label: '文字(書式付き)', hint: '太字・箇条書き・リンクが使える', icon: TextQuote },
  { type: 'number', label: '数値', hint: '数量、人数', icon: Hash },
  { type: 'currency', label: '金額', hint: '円の整数。一覧に合計が出る', icon: JapaneseYen },
  { type: 'percent', label: 'パーセント', hint: '確度、割合', icon: Percent },
  { type: 'date', label: '日付', hint: '期限、契約日', icon: Calendar },
  { type: 'datetime', label: '日時', hint: '訪問の日時', icon: CalendarClock },
  { type: 'select', label: '選択肢', hint: '状況、種別。カンバンの列になる', icon: ListChecks },
  { type: 'multi_select', label: '複数選択', hint: 'ラベル、タグ。いくつでも付けられる', icon: Tags },
  { type: 'checkbox', label: 'チェック', hint: 'はい / いいえ', icon: SquareCheck },
  { type: 'email', label: 'メール', hint: '押すとメールを書ける', icon: Mail },
  { type: 'phone', label: '電話', hint: '押すと電話をかけられる', icon: Phone },
  { type: 'url', label: 'URL', hint: '押すと別のタブで開く', icon: Link },
  { type: 'relation', label: '参照', hint: '別のテーブルのレコードを指す', icon: Spline },
  { type: 'user', label: '利用者', hint: '担当者', icon: User },
  { type: 'drive_files', label: 'Google ドライブ', hint: 'ドキュメントを作る、ドライブの資料を付ける(複数)', icon: Paperclip },
  { type: 'polymorphic', label: '関連先', hint: '複数のテーブルのどれかを指す', icon: Waypoints },
]

export function fieldType(type: FieldType) {
  return FIELD_TYPES.find((t) => t.type === type) ?? FIELD_TYPES[0]
}
