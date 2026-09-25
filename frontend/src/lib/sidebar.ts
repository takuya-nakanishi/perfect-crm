import type { FolderMeta, MetaResponse, ObjectMeta, SidebarItem } from '@/api/types'

/**
 * サイドバーの木(フォルダとテーブル)。形は PUT /meta/sidebar の本文(`SidebarItem[]`)そのままで、
 * 組み立て・動かす・番号を振る計算をここに集める。画面の楽観更新とモック(サーバ役)が同じ規則を使う。決まりは 05 §13
 */

/** 並びの中の 1 つ。テーブルは key、フォルダは id で指す */
export type SidebarRef = { type: 'object'; key: string } | { type: 'folder'; id: string }

/**
 * ドラッグで落とす先。
 * - before / after: その行の前・後ろ。フォルダを指したら、中のテーブルごとの塊の前・後ろ
 * - into: フォルダの中の末尾
 * - end: サイドバーの末尾(フォルダの外)
 */
export type SidebarDrop = { kind: 'before' | 'after'; ref: SidebarRef } | { kind: 'into'; folder: string } | { kind: 'end' }

type Tree = Pick<MetaResponse, 'objects' | 'folders'>

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position

/**
 * メタデータからサイドバーの並びを組む。直下はフォルダとテーブルを position の順に、フォルダの中はテーブルを position の順に。
 * サイドバーに出していないテーブルも、その場所に含める(並べ替えても居場所を失わないように)。無いフォルダを指すテーブルは直下へ
 */
export function sidebarItems(meta: Tree): SidebarItem[] {
  const folders = [...meta.folders].sort(byPosition)
  const ids = new Set(folders.map((f) => f.id))
  const objects = [...meta.objects].sort(byPosition)
  const top: { position: number; item: SidebarItem }[] = [
    ...folders.map((f) => ({ position: f.position, item: { type: 'folder' as const, id: f.id, label: f.label, keys: objects.filter((o) => o.folder_id === f.id).map((o) => o.key) } })),
    ...objects.filter((o) => !o.folder_id || !ids.has(o.folder_id)).map((o) => ({ position: o.position, item: { type: 'object' as const, key: o.key } })),
  ]
  // 同じ番号(復元したテーブルなど)はフォルダを先に。並べ替えは安定なので、あとは元の順
  return top.sort(byPosition).map((t) => t.item)
}

/** サイドバーに出すテーブルを、上から見える順に。畳んだフォルダの中も数える(1…9 のキーとコマンドパレットの数字はこの順) */
export function sidebarObjects(meta: Tree): ObjectMeta[] {
  const byKey = new Map(meta.objects.map((o) => [o.key, o]))
  return sidebarItems(meta)
    .flatMap((item) => (item.type === 'folder' ? item.keys : [item.key]))
    .flatMap((key) => {
      const o = byKey.get(key)
      return o?.in_sidebar ? [o] : []
    })
}

/**
 * 並びに番号を振る(サーバと同じ規則)。フォルダ → その中のテーブル → 次の…の順に、1 からの通し番号。
 * position だけで並べても、フォルダを全部開いたときの見える順になる
 */
export function numberSidebar(items: SidebarItem[]): {
  folders: FolderMeta[]
  places: Map<string, { position: number; folder_id?: string }>
  last: number
} {
  const folders: FolderMeta[] = []
  const places = new Map<string, { position: number; folder_id?: string }>()
  let n = 0
  for (const item of items) {
    if (item.type === 'object') {
      places.set(item.key, { position: ++n })
      continue
    }
    folders.push({ id: item.id, label: item.label.trim(), position: ++n })
    for (const key of item.keys) places.set(key, { position: ++n, folder_id: item.id })
  }
  return { folders, places, last: n }
}

/** 楽観更新: 保存する並びを、手元のメタデータへ先に当てる。本文に無いテーブルは、元の順で末尾に(フォルダの外)。サーバと同じ結果 */
export function applySidebar(meta: MetaResponse, items: SidebarItem[]): MetaResponse {
  const { folders, places, last } = numberSidebar(items)
  let n = last
  for (const o of [...meta.objects].sort(byPosition)) if (!places.has(o.key)) places.set(o.key, { position: ++n })
  return {
    ...meta,
    folders,
    objects: meta.objects.map((o) => {
      const place = places.get(o.key)!
      const next: ObjectMeta = { ...o, position: place.position, folder_id: place.folder_id }
      if (!place.folder_id) delete next.folder_id
      return next
    }),
  }
}

const sameRef = (a: SidebarRef, b: SidebarRef) => (a.type === 'object' ? b.type === 'object' && a.key === b.key : b.type === 'folder' && a.id === b.id)

const isRef = (item: SidebarItem, ref: SidebarRef) => (ref.type === 'object' ? item.type === 'object' && item.key === ref.key : item.type === 'folder' && item.id === ref.id)

/**
 * 並びの中で 1 つを動かす(ドラッグの結果)。フォルダはフォルダの中に入れられない。
 * 変わらないとき・成り立たないとき(無い行を指す、フォルダをフォルダへ)は null
 */
export function moveInSidebar(items: SidebarItem[], source: SidebarRef, drop: SidebarDrop): SidebarItem[] | null {
  if (drop.kind !== 'into' && drop.kind !== 'end' && sameRef(drop.ref, source)) return null

  // 1. 取り出す
  let moving: SidebarItem | undefined
  let rest: SidebarItem[]
  if (source.type === 'folder') {
    moving = items.find((i) => isRef(i, source))
    rest = items.filter((i) => i !== moving)
  } else {
    const found = items.some((i) => (i.type === 'object' ? i.key === source.key : i.keys.includes(source.key)))
    moving = found ? { type: 'object', key: source.key } : undefined
    rest = items.flatMap((i): SidebarItem[] => (i.type === 'object' ? (i.key === source.key ? [] : [i]) : [{ ...i, keys: i.keys.filter((k) => k !== source.key) }]))
  }
  if (!moving) return null

  // 2. 入れる
  let next: SidebarItem[]
  if (drop.kind === 'end') {
    next = [...rest, moving]
  } else if (drop.kind === 'into') {
    if (moving.type !== 'object') return null
    const key = moving.key
    const folder = rest.find((i) => i.type === 'folder' && i.id === drop.folder)
    if (!folder) return null
    next = rest.map((i) => (i === folder && i.type === 'folder' ? { ...i, keys: [...i.keys, key] } : i))
  } else {
    const index = rest.findIndex((i) => isRef(i, drop.ref))
    if (index >= 0) {
      const at = index + (drop.kind === 'after' ? 1 : 0)
      next = [...rest.slice(0, at), moving, ...rest.slice(at)]
    } else {
      // 直下に無い = フォルダの中のテーブルを指している。テーブルならその前後へ入る(フォルダは入れない)
      const ref = drop.ref
      if (ref.type !== 'object' || moving.type !== 'object') return null
      const key = moving.key
      const folder = rest.find((i) => i.type === 'folder' && i.keys.includes(ref.key))
      if (!folder || folder.type !== 'folder') return null
      const index = folder.keys.indexOf(ref.key) + (drop.kind === 'after' ? 1 : 0)
      next = rest.map((i) => (i === folder ? { ...folder, keys: [...folder.keys.slice(0, index), key, ...folder.keys.slice(index)] } : i))
    }
  }
  return JSON.stringify(next) === JSON.stringify(items) ? null : next
}

/** 新しいフォルダを先頭に足す(空のまま。テーブルはあとからドラッグで入れる) */
export function addFolder(items: SidebarItem[], folder: { id: string; label: string }): SidebarItem[] {
  return [{ type: 'folder', id: folder.id, label: folder.label, keys: [] }, ...items]
}

export function renameFolder(items: SidebarItem[], id: string, label: string): SidebarItem[] {
  return items.map((i) => (i.type === 'folder' && i.id === id ? { ...i, label } : i))
}

/** フォルダを消す。中のテーブルは、フォルダがあった場所へ同じ順で出る */
export function removeFolder(items: SidebarItem[], id: string): SidebarItem[] {
  return items.flatMap((i): SidebarItem[] => (i.type === 'folder' && i.id === id ? i.keys.map((key) => ({ type: 'object', key })) : [i]))
}

/**
 * ドラッグ中に指が乗っている場所(サイドバーの行が受け口として持つ)。
 * - object: テーブルの行(フォルダの中の行も)
 * - folder: フォルダの見出し(テーブルを受ける)。first は、開いているときに中で先頭に見えているテーブル
 * - block: フォルダの見出しと中身をまとめた塊(フォルダを受ける。フォルダはフォルダの外にしか置けないので)
 * - empty: 開いた空のフォルダに出す案内の行
 * - end: 並びの下の余白
 */
export type DropZone =
  | { zone: 'object'; key: string }
  | { zone: 'folder'; id: string; collapsed: boolean; first?: string }
  | { zone: 'block'; id: string }
  | { zone: 'empty'; id: string }
  | { zone: 'end' }

/**
 * 指の高さ(乗っている行の上端 0 〜 下端 1)から、落とす先を決める(Notion のサイドバーの型)。
 * フォルダの見出しは 3 つに分ける: 上の 1/4 はフォルダの前、真ん中はフォルダの中(末尾)、
 * 下の 1/4 は、開いていれば中の先頭、畳んでいればフォルダの後ろ
 */
export function resolveDrop(zone: DropZone, ratio: number): SidebarDrop {
  switch (zone.zone) {
    case 'object':
      return { kind: ratio < 0.5 ? 'before' : 'after', ref: { type: 'object', key: zone.key } }
    case 'block':
      return { kind: ratio < 0.5 ? 'before' : 'after', ref: { type: 'folder', id: zone.id } }
    case 'folder':
      if (ratio < 0.25) return { kind: 'before', ref: { type: 'folder', id: zone.id } }
      if (ratio <= 0.75) return { kind: 'into', folder: zone.id }
      if (zone.collapsed) return { kind: 'after', ref: { type: 'folder', id: zone.id } }
      return zone.first ? { kind: 'before', ref: { type: 'object', key: zone.first } } : { kind: 'into', folder: zone.id }
    case 'empty':
      return { kind: 'into', folder: zone.id }
    case 'end':
      return { kind: 'end' }
  }
}
