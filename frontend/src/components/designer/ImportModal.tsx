import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ChevronDown, FileUp, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { api, ApiError } from '@/api/client'
import type { MetaResponse, ObjectMeta } from '@/api/types'
import { Button, IconButton, ObjectIcon } from '@/components/ui/basics'
import { ChoiceList } from '@/components/ui/ChoiceList'
import { Modal, Popover } from '@/components/ui/overlay'
import { findObject } from '@/data/queries'
import { cx } from '@/lib/cx'
import { exportTable } from '@/data/exportTable'
import { readCsvFile } from '@/lib/download'
import { formatNumber } from '@/lib/format'
import { fieldType } from '@/lib/icons'
import { useUI } from '@/state/ui'

function FieldPicker({
  object,
  header,
  value,
  taken,
  onChange,
}: {
  object: ObjectMeta
  header: string
  value: string | null
  taken: Set<string>
  onChange: (key: string | null) => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const fields = object.fields.filter((f) => !f.readonly && f.type !== 'polymorphic')
  const current = fields.find((f) => f.key === value)
  const Icon = current ? fieldType(current.type).icon : null
  return (
    <>
      <button
        type="button"
        aria-label={`「${header}」の取り込み先`}
        aria-haspopup="listbox"
        onClick={(e) => setAnchor(e.currentTarget)}
        className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-sunken"
      >
        {Icon && <Icon size={15} className="flex-none text-ink-2" aria-hidden />}
        <span className={cx('min-w-0 flex-1 truncate', !current && 'text-ink-3')}>{current?.label ?? '取り込まない'}</span>
        <ChevronDown size={13} className="flex-none text-ink-3" aria-hidden />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={Math.max(240, anchor.offsetWidth)}>
          <ChoiceList
            choices={fields
              .filter((f) => f.key === value || !taken.has(f.key))
              .map((f) => ({
                id: f.key,
                node: <span className="truncate">{f.label}</span>,
                searchText: f.label,
                selected: f.key === value,
                commit: () => {
                  onChange(f.key)
                  setAnchor(null)
                },
              }))}
            clear={
              value
                ? () => {
                    onChange(null)
                    setAnchor(null)
                  }
                : undefined
            }
          />
        </Popover>
      )}
    </>
  )
}

/** CSV の取り込み。読む → 見出しと項目の対応を確かめる → 取り込む。解釈と検証はサーバがする(dry_run) */
export function ImportModal({ meta, objectKey }: { meta: MetaResponse; objectKey: string }) {
  const close = useUI((s) => s.closeImport)
  const toast = useUI((s) => s.toast)
  const qc = useQueryClient()
  const object = findObject(meta, objectKey)
  const [source, setSource] = useState<{ id: number; name: string; csv: string } | null>(null)
  const [overrides, setOverrides] = useState<Record<string, string | null>>({})
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  const preview = useQuery({
    queryKey: ['import-preview', objectKey, source?.id, overrides],
    queryFn: () => api.importRecords(objectKey, { csv: source!.csv, mapping: overrides, dry_run: true }),
    enabled: source !== null,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    gcTime: 0,
  })
  if (!object) return null

  const take = (name: string, csv: string) => {
    setOverrides({})
    setSource({ id: ++seq.current, name, csv })
  }
  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) take(file.name, await readCsvFile(file))
  }

  const result = source ? preview.data : undefined
  const run = async () => {
    if (!source || !result || busy) return
    setBusy(true)
    try {
      const done = await api.importRecords(objectKey, { csv: source.csv, mapping: result.mapping })
      void qc.invalidateQueries()
      close()
      toast({
        message: `${object.label}を ${formatNumber(done.created_ids.length)} 件取り込みました`,
        action: {
          label: '元に戻す',
          run: () => void Promise.all(done.created_ids.map((id) => api.deleteRecord(objectKey, id))).then(() => qc.invalidateQueries()),
        },
      })
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : '取り込めませんでした。もう一度試してください', tone: 'danger' })
      setBusy(false)
    }
  }

  const taken = new Set(Object.values(result?.mapping ?? {}).filter((v): v is string => Boolean(v)))

  return (
    <Modal label={`${object.label}に取り込む`} onClose={close} className="max-w-[720px]">
      <header className="flex flex-none items-center gap-2 px-5 pt-5 pb-3">
        <ObjectIcon icon={object.icon} color={object.color} size={16} />
        <h2 className="min-w-0 flex-1 truncate text-lg font-bold">{object.label}に CSV を取り込む</h2>
        <IconButton label="閉じる" onClick={close}>
          <X size={16} />
        </IconButton>
      </header>

      {!source || !result ? (
        <div
          className="px-5 pb-5"
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')
            if (text.includes('\n')) take('貼り付けた表', text)
          }}
        >
          <button
            type="button"
            autoFocus
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => void onDrop(e)}
            className={cx(
              'flex w-full flex-col items-center gap-2 rounded-lg border-[1.5px] border-dashed px-6 py-12 text-center transition-colors duration-100',
              dragOver ? 'border-accent bg-accent-wash' : 'border-line-strong hover:bg-chrome',
            )}
          >
            <FileUp size={28} strokeWidth={1.5} className="text-ink-3" aria-hidden />
            <span className="font-bold">CSV ファイルをここへ置く、または選ぶ</span>
            <span className="text-sm text-ink-2">Excel や表計算の範囲をコピーして、この画面に貼り付けても読めます</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (file) take(file.name, await readCsvFile(file))
            }}
          />
          <p className="mt-3 text-sm text-ink-2">
            1 行目を見出しとして読み、項目名と同じ見出しを自動で対応付けます。
            <button type="button" onClick={() => void exportTable(object)} className="underline decoration-line-strong underline-offset-4 hover:text-ink">
              いまの{object.label}を書き出して見本にする
            </button>
          </p>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-line">
            <div className="sticky top-0 grid h-9 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20px_minmax(0,1fr)] items-center gap-x-2 border-b border-line bg-raised px-5 text-sm text-ink-2">
              <span>CSV の見出し</span>
              <span>1 行目の値</span>
              <span />
              <span className="px-2">取り込み先の項目</span>
            </div>
            {result.headers.map((header, col) => (
              <div
                key={`${col}:${header}`}
                className={cx(
                  'grid min-h-10 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20px_minmax(0,1fr)] items-center gap-x-2 border-b border-line px-5',
                  !result.mapping[header] && 'text-ink-3',
                )}
              >
                <span className="truncate">{header || '(見出しなし)'}</span>
                <span className="truncate text-ink-2">{result.sample[0]?.[col] ?? ''}</span>
                <ArrowRight size={14} className="text-ink-3" aria-hidden />
                <FieldPicker object={object} header={header} value={result.mapping[header]} taken={taken} onChange={(key) => setOverrides((prev) => ({ ...prev, [header]: key }))} />
              </div>
            ))}
            {result.errors.length > 0 && (
              <div className="px-5 py-3">
                <h3 className="text-sm font-bold text-danger">取り込めない行(飛ばして進めます)</h3>
                <ul className="m-0 mt-1 list-none p-0 text-sm text-ink-2">
                  {result.errors.slice(0, 6).map((e) => (
                    <li key={e.line} className="flex gap-2">
                      <span className="w-12 flex-none text-ink-3 tabular-nums">{e.line} 行目</span>
                      <span className="min-w-0">{e.message}</span>
                    </li>
                  ))}
                </ul>
                {result.total - result.valid > 6 && <p className="mt-1 text-sm text-ink-3">ほか {formatNumber(result.total - result.valid - 6)} 行</p>}
              </div>
            )}
          </div>
          <footer className="flex flex-none flex-wrap items-center gap-2 border-t border-line bg-chrome px-5 py-3">
            <p className="min-w-0 flex-1 truncate text-sm text-ink-2">
              {formatNumber(result.total)} 行のうち <span className="font-bold text-ink tabular-nums">{formatNumber(result.valid)}</span> 行を取り込めます
              <span className="ml-2 text-ink-3">{source.name}</span>
            </p>
            <Button variant="ghost" onClick={() => setSource(null)}>
              別のファイルにする
            </Button>
            <Button variant="primary" disabled={busy || result.valid === 0 || taken.size === 0} onClick={() => void run()}>
              {formatNumber(result.valid)} 件を取り込む
            </Button>
          </footer>
        </>
      )}
    </Modal>
  )
}
