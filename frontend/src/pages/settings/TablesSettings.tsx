import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Plus } from 'lucide-react'
import { useEffect } from 'react'
import { useOutletContext, useSearchParams } from 'react-router'
import { api } from '@/api/client'
import type { MetaResponse, ObjectMeta } from '@/api/types'
import { Button, ObjectIcon } from '@/components/ui/basics'
import { keys } from '@/data/queries'
import { cx } from '@/lib/cx'
import { draftOf, toInput } from '@/lib/tableDraft'
import { useUI } from '@/state/ui'
import { SectionHeader } from './SettingsPage'

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={cx('relative h-5 w-9 flex-none rounded-full transition-colors duration-100', checked ? 'bg-accent' : 'bg-line-strong')}
    >
      <span className={cx('absolute top-0.5 size-4 rounded-full bg-paper shadow-card transition-transform duration-100', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  )
}

/** テーブルの一覧。項目の定義(テーブル設定)はここから開く。サイドバーに出すかはスイッチで */
export function TablesSettings() {
  const meta = useOutletContext<MetaResponse>()
  const [params, setParams] = useSearchParams()
  const openDesigner = useUI((s) => s.openDesigner)
  const toast = useUI((s) => s.toast)
  const qc = useQueryClient()
  const objects = [...meta.objects].sort((a, b) => a.position - b.position)

  // テーブルの画面の歯車(?object=)とサイドバーの「+」(?new)から来たら、そのまま設定を開く
  useEffect(() => {
    const object = params.get('object')
    const isNew = params.has('new')
    if (!object && !isNew) return
    openDesigner(object ?? undefined)
    setParams({}, { replace: true })
  }, [params, setParams, openDesigner])

  const setSidebar = (o: ObjectMeta, visible: boolean) => {
    // 楽観更新。定義の全量(ObjectInput)を送るのは、契約が PUT 1 本だから
    const before = qc.getQueryData<MetaResponse>(keys.meta)
    qc.setQueryData<MetaResponse>(keys.meta, (m) => (m ? { ...m, objects: m.objects.map((x) => (x.key === o.key ? { ...x, in_sidebar: visible } : x)) } : m))
    api
      .updateObject(o.key, { ...toInput(draftOf(o)), in_sidebar: visible })
      .then((next) => qc.setQueryData(keys.meta, next))
      .catch(() => {
        if (before) qc.setQueryData(keys.meta, before)
        toast({ message: '保存できませんでした。もう一度試してください', tone: 'danger' })
      })
  }

  return (
    <>
      <SectionHeader title="テーブル" hint="項目の定義と、サイドバーに出すか。並びはサイドバーの行をつまんで変えられます">
        <Button variant="primary" onClick={() => openDesigner()}>
          <Plus size={15} strokeWidth={2.5} aria-hidden />
          テーブルを追加
        </Button>
      </SectionHeader>
      <div className="px-5 pb-8 md:px-8">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_28px] items-center gap-x-4 border-b border-line px-2 pb-2 text-sm text-ink-2">
          <span>テーブル</span>
          <span className="w-16 text-right tabular-nums">項目</span>
          <span className="w-24 text-center">サイドバー</span>
          <span />
        </div>
        {objects.map((o) => (
          <div
            key={o.key}
            role="button"
            tabIndex={0}
            onClick={() => openDesigner(o.key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target === e.currentTarget) openDesigner(o.key)
            }}
            className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto_28px] items-center gap-x-4 border-b border-line px-2 py-2.5 hover:bg-chrome"
          >
            <span className="flex min-w-0 items-center gap-3">
              <ObjectIcon icon={o.icon} color={o.color} size={16} />
              <span className="min-w-0">
                <span className="block truncate font-bold">{o.label}</span>
                <span className="block truncate text-sm text-ink-3">
                  {o.key}
                  {o.system && ' · 初めから'}
                  {o.timeline && ' · 時系列'}
                  {o.completion && ' · 完了できる'}
                </span>
              </span>
            </span>
            <span className="w-16 text-right text-ink-2 tabular-nums">{o.fields.filter((f) => !f.readonly).length}</span>
            <span className="flex w-24 justify-center">
              <Switch checked={o.in_sidebar} label={`「${o.label}」をサイドバーに出す`} onChange={(v) => setSidebar(o, v)} />
            </span>
            <ChevronRight size={16} className="text-ink-3" aria-hidden />
          </div>
        ))}
        <p className="mt-4 text-sm text-ink-3">サイドバーに出さないテーブルも、レコードのパネルの関連リストや検索、URL からは開けます。活動のように、レコード単位で見れば足りるものは出さないでおけます。</p>
      </div>
    </>
  )
}
