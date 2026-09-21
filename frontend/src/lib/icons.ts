import {
  Building2,
  ChartColumn,
  CircleCheck,
  ContactRound,
  Handshake,
  Rows3,
  SquareKanban,
  Table2,
  type LucideIcon,
} from 'lucide-react'
import type { ViewType } from '@/api/types'

/** メタデータのアイコン名 → コンポーネント。使うものだけ載せる(全部を束ねると重くなる) */
const OBJECT_ICONS: Record<string, LucideIcon> = {
  'building-2': Building2,
  'contact-round': ContactRound,
  handshake: Handshake,
  'circle-check': CircleCheck,
}

export function objectIcon(name: string): LucideIcon {
  return OBJECT_ICONS[name] ?? Table2
}

export const VIEW_ICONS: Record<ViewType, LucideIcon> = {
  list: Rows3,
  kanban: SquareKanban,
  report: ChartColumn,
}
