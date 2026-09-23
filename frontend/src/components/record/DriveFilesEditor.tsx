import { useQuery } from '@tanstack/react-query'
import { ExternalLink, FilePlus2, FolderSearch, LogIn, X } from 'lucide-react'
import { useState } from 'react'
import { api, ApiError } from '@/api/client'
import type { DriveFile, FieldMeta, ObjectMeta, Row, Scalar } from '@/api/types'
import { ChoiceList } from '@/components/ui/ChoiceList'
import { Popover } from '@/components/ui/overlay'
import { cx } from '@/lib/cx'
import { driveKind, parseDriveFiles } from '@/lib/drive'
import { useDebounced } from '@/lib/useDebounced'
import { useUI } from '@/state/ui'

/** ファイル 1 つ。押すと別のタブで開く */
export function DriveChip({ file, onRemove }: { file: DriveFile; onRemove?: () => void }) {
  const kind = driveKind(file.mime_type)
  return (
    <span className="group/chip inline-flex h-7 max-w-full items-center gap-1 rounded-md pl-1 text-base shadow-[inset_0_0_0_1px_var(--line)] hover:bg-sunken">
      <a href={file.url} target="_blank" rel="noreferrer" title={`${kind.label}「${file.name}」を開く`} className="flex min-w-0 items-center gap-1.5 pr-1.5">
        <span className="grid size-5 flex-none place-items-center rounded" style={{ background: `var(--tag-${kind.color}-bg)`, color: `var(--tag-${kind.color}-ink)` }}>
          <kind.icon size={12} aria-hidden />
        </span>
        <span className="truncate">{file.name}</span>
        <ExternalLink size={11} className="flex-none text-ink-3" aria-hidden />
      </a>
      {onRemove && (
        <button
          type="button"
          aria-label={`「${file.name}」を外す`}
          onClick={onRemove}
          className="mr-0.5 grid size-5 flex-none place-items-center rounded text-ink-3 opacity-0 group-focus-within/chip:opacity-100 group-hover/chip:opacity-100 hover:bg-paper hover:text-ink [@media(hover:none)]:opacity-100"
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </span>
  )
}

/**
 * Google ドライブの項目(複数)。「新規」で「マイドライブ / CRM / テーブル名 / レコード名」のドキュメントを作り、
 * 「参照」でドライブの中から選んで付ける。外すのは項目の値の書き換え(サーバはファイルを消さない)
 */
export function DriveFilesEditor({
  object,
  field,
  row,
  onCommit,
}: {
  object: ObjectMeta
  field: FieldMeta
  row: Row
  onCommit: (patch: Record<string, Scalar>) => void
}) {
  const toast = useUI((s) => s.toast)
  const files = parseDriveFiles(row[field.key])
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const q = useDebounced(query, 150)
  // 繋がり具合は利用者ごと。Google から戻ってくるのは画面ごとの読み直しなので、ここでは持ち越さない
  const google = useQuery({ queryKey: ['google-status'], queryFn: () => api.googleStatus(), staleTime: 60_000 })
  const candidates = useQuery({
    queryKey: ['drive', q],
    queryFn: () => api.listDriveFiles(q),
    enabled: anchor !== null && google.data?.connected === true,
    staleTime: 30_000,
  })
  const isDraft = row.id === 'draft'

  const write = (next: DriveFile[]) => onCommit({ [field.key]: next.length ? JSON.stringify(next) : null })
  const create = async () => {
    setCreating(true)
    try {
      const res = await api.createDriveDocument(object.key, row.id, field.key)
      onCommit({ [field.key]: res.record[field.key] ?? null })
      const made = parseDriveFiles(res.record[field.key]).at(-1)
      toast({
        message: `ドキュメント「${made?.name ?? ''}」を作りました`,
        action: made ? { label: '開く', run: () => window.open(made.url, '_blank', 'noreferrer') } : undefined,
      })
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : 'ドキュメントを作れませんでした。もう一度試してください', tone: 'danger' })
    } finally {
      setCreating(false)
    }
  }

  const connect = async () => {
    try {
      // 許可の画面はサーバが組み立てる(client_id も scope も画面は知らない)
      const { url } = await api.googleConnect()
      location.assign(url)
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : 'Google に繋げませんでした', tone: 'danger' })
    }
  }

  const btn = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm text-ink-2 hover:bg-sunken hover:text-ink disabled:opacity-50'
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1.5 py-0.5">
      {files.map((f) => (
        <DriveChip key={f.id} file={f} onRemove={() => write(files.filter((x) => x.id !== f.id))} />
      ))}
      {isDraft ? (
        <span className="px-2 text-sm text-ink-3">作成してから付けられます</span>
      ) : google.data && !google.data.configured ? (
        <span className="px-2 text-sm text-ink-3">Google 連携が設定されていません(管理者に頼んでください)</span>
      ) : google.data && !google.data.connected ? (
        <button type="button" className={btn} onClick={() => void connect()} title="自分の Google アカウントを繋ぐと、ドライブのファイルを付けられます">
          <LogIn size={14} aria-hidden />
          Google に接続
        </button>
      ) : (
        <>
          <button type="button" className={btn} disabled={creating} onClick={() => void create()} title="マイドライブ / CRM / このテーブル名 / の中に、レコード名のドキュメントを作る">
            <FilePlus2 size={14} aria-hidden />
            {creating ? '作っています…' : '新規'}
          </button>
          <button type="button" className={cx(btn, anchor && 'bg-sunken text-ink')} aria-haspopup="listbox" onClick={(e) => setAnchor(e.currentTarget)}>
            <FolderSearch size={14} aria-hidden />
            参照
          </button>
        </>
      )}
      {anchor && (
        <Popover
          anchor={anchor}
          onClose={() => {
            setAnchor(null)
            setQuery('')
          }}
          width={340}
        >
          <ChoiceList
            query={query}
            onQuery={setQuery}
            placeholder="マイドライブを探す"
            loading={candidates.isLoading}
            choices={(candidates.data ?? []).map((f) => {
              const kind = driveKind(f.mime_type)
              const attached = files.some((x) => x.id === f.id)
              return {
                id: f.id,
                node: (
                  <>
                    <span className="grid size-5 flex-none place-items-center rounded" style={{ background: `var(--tag-${kind.color}-bg)`, color: `var(--tag-${kind.color}-ink)` }}>
                      <kind.icon size={12} aria-hidden />
                    </span>
                    <span className="truncate">{f.name}</span>
                    <span className="ml-auto flex-none text-xs text-ink-3">{kind.label}</span>
                  </>
                ),
                searchText: f.name,
                selected: attached,
                // 押すたびに付け外し。何件でも選べるので、一覧は開いたまま
                commit: () => write(attached ? files.filter((x) => x.id !== f.id) : [...files, f]),
              }
            })}
          />
          <p className="flex items-center gap-2 border-t border-line px-3 py-2 text-xs text-ink-3">
            <span className="truncate">押すと付き、もう一度押すと外れます。Esc で閉じる</span>
            {google.data?.email && (
              <button
                type="button"
                className="ml-auto flex-none underline decoration-line underline-offset-2 hover:text-ink"
                title={`${google.data.email} の繋ぎを外す(ドライブのファイルは消えません)`}
                onClick={async () => {
                  await api.googleDisconnect()
                  await google.refetch()
                  setAnchor(null)
                }}
              >
                {google.data.email} を外す
              </button>
            )}
          </p>
        </Popover>
      )}
    </div>
  )
}
