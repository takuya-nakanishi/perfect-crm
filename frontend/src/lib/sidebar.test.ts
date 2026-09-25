import { describe, expect, it } from 'vitest'
import type { FolderMeta, MetaResponse, ObjectMeta, SidebarItem } from '@/api/types'
import { addFolder, applySidebar, moveInSidebar, removeFolder, renameFolder, resolveDrop, sidebarItems, sidebarObjects } from './sidebar'

// テストケース表: docs/tests/meta.md。1 つの it が表の 1 行(ID をラベルに入れる)
const SALES = '0199a000-0000-7000-8000-000000000001'
const PROJECTS = '0199a000-0000-7000-8000-000000000002'

const object = (key: string, position: number, extra: Partial<ObjectMeta> = {}): ObjectMeta => ({
  key,
  label: key,
  icon: 'box',
  color: 'blue',
  name_field: 'name',
  position,
  in_sidebar: true,
  fields: [],
  ...extra,
})

/** 営業(取引先・責任者・商談)→ タスク → プロジェクト(夢リスト)→ 活動(サイドバーに出さない) */
function sample(): MetaResponse {
  const folders: FolderMeta[] = [
    { id: SALES, label: '営業', position: 1 },
    { id: PROJECTS, label: 'プロジェクト', position: 6 },
  ]
  return {
    workspace: { id: 'w', name: 'w', timezone: 'Asia/Tokyo' },
    folders,
    // わざと position の順に並べない(組み立てが並べ直すことを見る)
    objects: [
      object('tasks', 5),
      object('opportunities', 4, { folder_id: SALES }),
      object('accounts', 2, { folder_id: SALES }),
      object('activities', 8, { in_sidebar: false }),
      object('dreams', 7, { folder_id: PROJECTS }),
      object('contacts', 3, { folder_id: SALES }),
    ],
    views: [],
    users: [],
  }
}

const items = (): SidebarItem[] => sidebarItems(sample())
const keysOf = (list: SidebarItem[]) => list.map((i) => (i.type === 'object' ? i.key : `${i.label}[${i.keys.join(',')}]`))

describe('サイドバーのフォルダと並び(lib/sidebar.ts)', () => {
  it('META-110 sidebarItems はフォルダとテーブルを position の順に組み、フォルダの中も position の順。出していないテーブルも含め、無いフォルダを指すテーブルは直下へ', () => {
    expect(items()).toEqual([
      { type: 'folder', id: SALES, label: '営業', keys: ['accounts', 'contacts', 'opportunities'] },
      { type: 'object', key: 'tasks' },
      { type: 'folder', id: PROJECTS, label: 'プロジェクト', keys: ['dreams'] },
      { type: 'object', key: 'activities' },
    ])
    // 無いフォルダ(消えたもの)を指すテーブルは、直下の自分の番号の場所に出る。空のフォルダも残る
    const meta = sample()
    meta.folders = meta.folders.filter((f) => f.id !== PROJECTS)
    meta.folders.push({ id: '0199a000-0000-7000-8000-000000000003', label: '空', position: 9 })
    expect(keysOf(sidebarItems(meta))).toEqual(['営業[accounts,contacts,opportunities]', 'tasks', 'dreams', 'activities', '空[]'])
  })

  it('META-111 sidebarObjects は出しているテーブルを見える順に返す(フォルダの中も数える)。出していないテーブルは除く', () => {
    expect(sidebarObjects(sample()).map((o) => o.key)).toEqual(['accounts', 'contacts', 'opportunities', 'tasks', 'dreams'])
    // フォルダの中の順を変えれば、数字の順も付いてくる
    const moved = moveInSidebar(items(), { type: 'object', key: 'opportunities' }, { kind: 'before', ref: { type: 'object', key: 'accounts' } })!
    expect(sidebarObjects(applySidebar(sample(), moved)).map((o) => o.key)).toEqual(['opportunities', 'accounts', 'contacts', 'tasks', 'dreams'])
  })

  it('META-112 moveInSidebar はテーブルを行の前後・フォルダの中・末尾へ動かし、フォルダは塊ごと直下で動く。成り立たない・変わらない移動は null', () => {
    const move = (source: Parameters<typeof moveInSidebar>[1], drop: Parameters<typeof moveInSidebar>[2]) => {
      const next = moveInSidebar(items(), source, drop)
      return next && keysOf(next)
    }
    const tasks = { type: 'object', key: 'tasks' } as const
    // 直下のテーブルを、フォルダの中の行の前・後ろへ(フォルダに入る)
    expect(move(tasks, { kind: 'before', ref: { type: 'object', key: 'contacts' } })).toEqual(['営業[accounts,tasks,contacts,opportunities]', 'プロジェクト[dreams]', 'activities'])
    expect(move(tasks, { kind: 'after', ref: { type: 'object', key: 'dreams' } })).toEqual(['営業[accounts,contacts,opportunities]', 'プロジェクト[dreams,tasks]', 'activities'])
    // フォルダの末尾へ(見出しの真ん中に落とす)
    expect(move(tasks, { kind: 'into', folder: PROJECTS })).toEqual(['営業[accounts,contacts,opportunities]', 'プロジェクト[dreams,tasks]', 'activities'])
    // フォルダの中から外へ: 直下の行の後ろ、フォルダの前、末尾
    const accounts = { type: 'object', key: 'accounts' } as const
    expect(move(accounts, { kind: 'after', ref: tasks })).toEqual(['営業[contacts,opportunities]', 'tasks', 'accounts', 'プロジェクト[dreams]', 'activities'])
    expect(move(accounts, { kind: 'before', ref: { type: 'folder', id: SALES } })).toEqual(['accounts', '営業[contacts,opportunities]', 'tasks', 'プロジェクト[dreams]', 'activities'])
    expect(move(accounts, { kind: 'end' })).toEqual(['営業[contacts,opportunities]', 'tasks', 'プロジェクト[dreams]', 'activities', 'accounts'])
    // フォルダからフォルダへ
    expect(move(accounts, { kind: 'into', folder: PROJECTS })).toEqual(['営業[contacts,opportunities]', 'tasks', 'プロジェクト[dreams,accounts]', 'activities'])
    // フォルダは中身ごと動く
    const sales = { type: 'folder', id: SALES } as const
    expect(move(sales, { kind: 'after', ref: { type: 'folder', id: PROJECTS } })).toEqual(['tasks', 'プロジェクト[dreams]', '営業[accounts,contacts,opportunities]', 'activities'])
    expect(move(sales, { kind: 'after', ref: tasks })).toEqual(['tasks', '営業[accounts,contacts,opportunities]', 'プロジェクト[dreams]', 'activities'])
    expect(move(sales, { kind: 'end' })).toEqual(['tasks', 'プロジェクト[dreams]', 'activities', '営業[accounts,contacts,opportunities]'])

    // 成り立たない: フォルダをフォルダの中へ(中の行の前後・見出しの中)、無い行・無いフォルダ
    expect(move(sales, { kind: 'into', folder: PROJECTS })).toBeNull()
    expect(move(sales, { kind: 'before', ref: { type: 'object', key: 'dreams' } })).toBeNull()
    expect(move(tasks, { kind: 'into', folder: 'no-such-folder' })).toBeNull()
    expect(move(tasks, { kind: 'before', ref: { type: 'object', key: 'no_such_table' } })).toBeNull()
    expect(move({ type: 'object', key: 'no_such_table' }, { kind: 'end' })).toBeNull()
    // 変わらない: 自分の前後、すぐ上の行の後ろ、末尾の行を末尾へ
    expect(move(tasks, { kind: 'before', ref: tasks })).toBeNull()
    expect(move(sales, { kind: 'after', ref: sales })).toBeNull()
    expect(move(tasks, { kind: 'after', ref: { type: 'folder', id: SALES } })).toBeNull()
    expect(move({ type: 'object', key: 'contacts' }, { kind: 'after', ref: accounts })).toBeNull()
    expect(move({ type: 'object', key: 'activities' }, { kind: 'end' })).toBeNull()
    expect(move({ type: 'object', key: 'opportunities' }, { kind: 'into', folder: SALES })).toBeNull()
  })

  it('META-113 resolveDrop: テーブルの行は上半分が前・下半分が後ろ。フォルダの見出しは上 1/4 が前、真ん中が中、下 1/4 は開いていれば中の先頭・畳んでいれば後ろ', () => {
    const row = { zone: 'object', key: 'tasks' } as const
    expect(resolveDrop(row, 0.1)).toEqual({ kind: 'before', ref: { type: 'object', key: 'tasks' } })
    expect(resolveDrop(row, 0.49)).toEqual({ kind: 'before', ref: { type: 'object', key: 'tasks' } })
    expect(resolveDrop(row, 0.5)).toEqual({ kind: 'after', ref: { type: 'object', key: 'tasks' } })

    const open = { zone: 'folder', id: SALES, collapsed: false, first: 'accounts' } as const
    expect(resolveDrop(open, 0.2)).toEqual({ kind: 'before', ref: { type: 'folder', id: SALES } })
    expect(resolveDrop(open, 0.25)).toEqual({ kind: 'into', folder: SALES })
    expect(resolveDrop(open, 0.75)).toEqual({ kind: 'into', folder: SALES })
    expect(resolveDrop(open, 0.8)).toEqual({ kind: 'before', ref: { type: 'object', key: 'accounts' } })
    // 開いていても中が見えていなければ(空)、下の 1/4 も中
    expect(resolveDrop({ ...open, first: undefined }, 0.9)).toEqual({ kind: 'into', folder: SALES })
    // 畳んでいれば、下の 1/4 はフォルダの後ろ
    expect(resolveDrop({ ...open, collapsed: true }, 0.9)).toEqual({ kind: 'after', ref: { type: 'folder', id: SALES } })

    // フォルダを動かすときの塊、空のフォルダの案内、下の余白
    expect(resolveDrop({ zone: 'block', id: PROJECTS }, 0.3)).toEqual({ kind: 'before', ref: { type: 'folder', id: PROJECTS } })
    expect(resolveDrop({ zone: 'block', id: PROJECTS }, 0.7)).toEqual({ kind: 'after', ref: { type: 'folder', id: PROJECTS } })
    expect(resolveDrop({ zone: 'empty', id: PROJECTS }, 0.1)).toEqual({ kind: 'into', folder: PROJECTS })
    expect(resolveDrop({ zone: 'end' }, 0.5)).toEqual({ kind: 'end' })
  })

  it('META-114 フォルダを消すと中のテーブルがその場所へ同じ順で出る。applySidebar はサーバと同じ通し番号を振り、本文に無いテーブルは末尾でフォルダの外', () => {
    // 足す(先頭に空で)・名前を変える・消す
    const NEW = '0199a000-0000-7000-8000-000000000009'
    expect(keysOf(addFolder(items(), { id: NEW, label: '新しいフォルダ' }))[0]).toBe('新しいフォルダ[]')
    expect(keysOf(renameFolder(items(), SALES, '営業部'))[0]).toBe('営業部[accounts,contacts,opportunities]')
    expect(keysOf(removeFolder(items(), SALES))).toEqual(['accounts', 'contacts', 'opportunities', 'tasks', 'プロジェクト[dreams]', 'activities'])

    // 通し番号: フォルダ → その中のテーブル → 次の…。position だけで並べても見える順になる
    const applied = applySidebar(sample(), items())
    expect(applied.folders).toEqual([
      { id: SALES, label: '営業', position: 1 },
      { id: PROJECTS, label: 'プロジェクト', position: 6 },
    ])
    const at = (meta: MetaResponse) => Object.fromEntries(meta.objects.map((o) => [o.key, [o.position, o.folder_id ?? null]]))
    expect(at(applied)).toEqual({
      accounts: [2, SALES],
      contacts: [3, SALES],
      opportunities: [4, SALES],
      tasks: [5, null],
      dreams: [7, PROJECTS],
      activities: [8, null],
    })
    // フォルダを消して当てると、中のテーブルから folder_id が外れる。本文に無いテーブル(dreams)は末尾でフォルダの外
    const partial = removeFolder(items(), PROJECTS).filter((i) => i.type !== 'object' || i.key !== 'dreams')
    const after = applySidebar(sample(), partial)
    expect(after.folders.map((f) => f.label)).toEqual(['営業'])
    expect(at(after)).toEqual({
      accounts: [2, SALES],
      contacts: [3, SALES],
      opportunities: [4, SALES],
      tasks: [5, null],
      activities: [6, null],
      dreams: [7, null],
    })
    // 名前の前後の空白は、サーバと同じく落とす
    expect(applySidebar(sample(), renameFolder(items(), SALES, '  営業部 ')).folders[0].label).toBe('営業部')
  })
})
