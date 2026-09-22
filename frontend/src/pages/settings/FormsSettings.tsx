import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Pencil, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useOutletContext } from 'react-router'
import { api, ApiError } from '@/api/client'
import type { FieldMeta, MetaResponse, ObjectMeta, Row, Scalar, WebForm, WebFormInput } from '@/api/types'
import { FieldEditor } from '@/components/record/FieldEditor'
import { Button, IconButton, ObjectIcon, Tag } from '@/components/ui/basics'
import { Modal } from '@/components/ui/overlay'
import { Select } from '@/components/view/ConditionEditor'
import { copyText } from '@/lib/clipboard'
import { cx } from '@/lib/cx'
import { formatDateTime } from '@/lib/dates'
import { fieldType } from '@/lib/icons'
import { usePeek } from '@/lib/usePeek'
import { useUI } from '@/state/ui'
import { SectionHeader } from './SettingsPage'

const endpointOf = (form: WebForm) => `${location.origin}/api/v1/forms/${form.key}`

/** 受け付けられる項目(システムの列・関連先・ドライブは受けない) */
const acceptable = (o: ObjectMeta) => o.fields.filter((f) => !f.readonly && f.type !== 'polymorphic' && f.type !== 'drive_files')

const INPUT_TYPES: Partial<Record<FieldMeta['type'], string>> = { email: 'email', phone: 'tel', url: 'url', number: 'number', currency: 'number', percent: 'number', date: 'date', datetime: 'datetime-local', checkbox: 'checkbox' }

/** Web サイトに貼る HTML。項目の型に合わせた <input>。送信先はフォームの受け口 */
function htmlSnippet(form: WebForm, object: ObjectMeta): string {
  const lines = [`<form action="${endpointOf(form)}" method="post">`]
  for (const key of form.fields) {
    const f = object.fields.find((x) => x.key === key)
    if (!f) continue
    const id = `works-${key}`
    if (f.type === 'select') {
      lines.push(`  <label for="${id}">${f.label}</label>`, `  <select id="${id}" name="${key}">`)
      for (const o of f.options ?? []) lines.push(`    <option value="${o.value}">${o.label}</option>`)
      lines.push('  </select>')
    } else if (f.type === 'textarea' || f.type === 'richtext') {
      lines.push(`  <label for="${id}">${f.label}</label>`, `  <textarea id="${id}" name="${key}" rows="4"></textarea>`)
    } else {
      const type = INPUT_TYPES[f.type] ?? 'text'
      lines.push(`  <label for="${id}">${f.label}</label>`, `  <input id="${id}" name="${key}" type="${type}"${f.required ? ' required' : ''}>`)
    }
  }
  // 人には見えない欄。bot が埋めたら捨てる
  lines.push('  <input name="_gotcha" type="text" style="display:none" tabindex="-1" autocomplete="off">', '  <button type="submit">送信</button>', '</form>')
  return lines.join('\n')
}

function curlSnippet(form: WebForm, object: ObjectMeta): string {
  const sample: Record<string, string> = {}
  for (const key of form.fields) {
    const f = object.fields.find((x) => x.key === key)
    if (f) sample[key] = f.type === 'email' ? 'taro@example.jp' : f.type === 'phone' ? '03-0000-0000' : f.type === 'select' ? (f.options?.[0]?.value ?? '') : `${f.label}の値`
  }
  // 受け口も Access の内側(06 §7)。Web サイトのサーバ(問い合わせフォームの送信先)が、サービストークンを付けて転送する
  return `curl -X POST ${endpointOf(form)} \\\n  -H "Content-Type: application/json" \\\n  -H "CF-Access-Client-Id: <Access のサービストークンの ID>" \\\n  -H "CF-Access-Client-Secret: <Access のサービストークンの Secret>" \\\n  -d '${JSON.stringify(sample)}'`
}

function Snippet({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-lg shadow-[inset_0_0_0_1px_var(--line)]">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h4 className="min-w-0 flex-1 truncate text-sm font-bold">{title}</h4>
        <IconButton label="コピー" onClick={() => void copyText(body)}>
          <Copy size={14} />
        </IconButton>
      </header>
      <pre className="max-h-72 overflow-auto px-3 py-2.5 font-sans text-sm leading-5 whitespace-pre text-ink-2">{body}</pre>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 作成・編集
// ---------------------------------------------------------------------------

function FormEditor({ meta, form, onClose }: { meta: MetaResponse; form: WebForm | null; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useUI((s) => s.toast)
  const objects = [...meta.objects].sort((a, b) => a.position - b.position)
  const [draft, setDraft] = useState<WebFormInput>(() =>
    form
      ? { name: form.name, object: form.object, fields: form.fields, defaults: form.defaults, enabled: form.enabled, redirect_url: form.redirect_url }
      : { name: '', object: objects[0]?.key ?? '', fields: [], defaults: {}, enabled: true, redirect_url: null },
  )
  const object = meta.objects.find((o) => o.key === draft.object)
  const fields = object ? acceptable(object) : []
  const [showErrors, setShowErrors] = useState(false)
  const save = useMutation({
    mutationFn: () => (form ? api.updateWebForm(form.id, draft) : api.createWebForm(draft)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['web-forms'] })
      toast({ message: form ? 'フォームを保存しました' : 'フォームを作りました。埋め込み用の HTML を Web サイトに貼ってください' })
      onClose()
    },
    onError: (e) => toast({ message: e instanceof ApiError ? e.message : '保存できませんでした', tone: 'danger' }),
  })
  const toggleField = (key: string) => setDraft((d) => ({ ...d, fields: d.fields.includes(key) ? d.fields.filter((k) => k !== key) : [...d.fields, key] }))
  // 既定値は「受け付けない項目」に入れる(受け付ける項目は送信者が決める)
  const defaultCandidates = fields.filter((f) => !draft.fields.includes(f.key) && f.type !== 'textarea' && f.type !== 'richtext')
  const defaultsRow: Row = { id: 'draft', ...draft.defaults }
  const invalid = !draft.name.trim() || draft.fields.length === 0
  const input = 'h-9 w-full rounded-md bg-paper px-2 text-base text-ink outline-none shadow-[inset_0_0_0_1px_var(--line-strong)] placeholder:text-ink-3 focus:shadow-[inset_0_0_0_1.5px_var(--accent)]'

  return (
    <Modal label={form ? 'フォームを編集' : 'フォームを作る'} onClose={onClose} className="h-[min(720px,100%)] max-w-[720px]">
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          if (invalid) return setShowErrors(true)
          save.mutate()
        }}
      >
        <header className="px-5 pt-5 pb-3">
          <h2 className="text-lg font-bold">{form ? 'フォームを編集' : 'Web フォームを作る'}</h2>
          <p className="mt-0.5 text-sm text-ink-2">Web サイトの入力を、そのままこのワークスペースのレコードにします。どのテーブルにも作れます</p>
        </header>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 pb-5">
          <label className="grid gap-1 text-sm text-ink-2">
            名前
            <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Web サイトのお問い合わせ" className={input} aria-invalid={showErrors && !draft.name.trim()} />
          </label>
          <div className="grid gap-1 text-sm text-ink-2">
            レコードを作るテーブル
            <Select value={draft.object} label="テーブル" onChange={(key) => setDraft({ ...draft, object: key, fields: [], defaults: {} })}>
              {objects.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1 text-sm text-ink-2">
            <span>
              受け付ける項目 <span className="text-ink-3">(押した順に並びます)</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {fields.map((f) => {
                const on = draft.fields.includes(f.key)
                const t = fieldType(f.type)
                return (
                  <button
                    key={f.key}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => toggleField(f.key)}
                    className={cx('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-base', on ? 'bg-accent-wash font-bold text-accent-ink' : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-sunken')}
                  >
                    {on ? <Check size={13} aria-hidden /> : <t.icon size={13} className="text-ink-3" aria-hidden />}
                    {f.label}
                    {on && <span className="text-xs opacity-70 tabular-nums">{draft.fields.indexOf(f.key) + 1}</span>}
                  </button>
                )
              })}
            </div>
            {showErrors && draft.fields.length === 0 && <p className="text-danger">受け付ける項目を 1 つ以上選んでください</p>}
          </div>
          {object && defaultCandidates.length > 0 && (
            <div className="grid gap-1 text-sm text-ink-2">
              <span>
                既定値 <span className="text-ink-3">(受け付けない項目に、いつも入れる値。種別 = 見込み客、など)</span>
              </span>
              <dl className="m-0 grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5 rounded-lg p-2 shadow-[inset_0_0_0_1px_var(--line)]">
                {defaultCandidates.map((f) => (
                  <div key={f.key} className="contents">
                    <dt className="flex h-8 items-center truncate text-ink-2">{f.label}</dt>
                    <dd className="m-0 min-w-0">
                      <FieldEditor
                        meta={meta}
                        object={object}
                        field={f}
                        row={defaultsRow}
                        references={{}}
                        onCommit={(patch) => {
                          const next = { ...draft.defaults, ...patch }
                          for (const k of Object.keys(next)) if (next[k] === null || next[k] === '') delete next[k]
                          setDraft({ ...draft, defaults: next as Record<string, Scalar> })
                        }}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <label className="grid gap-1 text-sm text-ink-2">
            送信後に戻す URL <span className="text-ink-3">(空なら「受け付けました」の小さな画面)</span>
            <input value={draft.redirect_url ?? ''} onChange={(e) => setDraft({ ...draft, redirect_url: e.target.value || null })} placeholder="https://example.jp/thanks" className={input} />
          </label>
          <label className="flex h-8 items-center gap-2 text-base">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} className="accent-[var(--accent)]" />
            受け付ける(外すと、受け口は 404 を返す)
          </label>
        </div>
        <footer className="flex justify-end gap-2 border-t border-line bg-chrome px-5 py-3">
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" type="submit" disabled={save.isPending}>
            {form ? '保存する' : 'フォームを作る'}
          </Button>
        </footer>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// 一覧
// ---------------------------------------------------------------------------

function FormCard({ meta, form, onEdit }: { meta: MetaResponse; form: WebForm; onEdit: () => void }) {
  const qc = useQueryClient()
  const toast = useUI((s) => s.toast)
  const { openPeek } = usePeek()
  const object = meta.objects.find((o) => o.key === form.object)
  const [tab, setTab] = useState<'html' | 'curl'>('curl')
  const refresh = () => qc.invalidateQueries({ queryKey: ['web-forms'] })
  const rotate = useMutation({ mutationFn: () => api.rotateWebFormKey(form.id), onSuccess: () => (void refresh(), toast({ message: '鍵を作り直しました。古い URL は効きません。Web サイトの HTML を貼り直してください' })) })
  const remove = useMutation({ mutationFn: () => api.deleteWebForm(form.id), onSuccess: () => (void refresh(), toast({ message: `フォーム「${form.name}」を削除しました` })) })
  const test = useMutation({
    mutationFn: () => {
      // 受け付ける項目に見本の値を入れて、本物の受け口へ送る
      const values: Record<string, Scalar> = {}
      for (const key of form.fields) {
        const f = object?.fields.find((x) => x.key === key)
        if (!f) continue
        values[key] = f.type === 'email' ? 'test@example.jp' : f.type === 'phone' ? '03-0000-0000' : f.type === 'select' ? (f.options?.[0]?.value ?? null) : ['number', 'currency', 'percent'].includes(f.type) ? 1 : f.type === 'date' ? new Date().toISOString().slice(0, 10) : f.type === 'checkbox' ? true : `テスト送信(${f.label})`
      }
      return api.submitWebForm(form.key, values)
    },
    onSuccess: (res) => {
      void refresh()
      void qc.invalidateQueries({ queryKey: ['records'] })
      toast({ message: `${object?.label ?? ''}にレコードができました`, action: { label: '開く', run: () => openPeek(form.object, res.record.id) } })
    },
    onError: (e) => toast({ message: e instanceof ApiError ? e.message : '送れませんでした', tone: 'danger' }),
  })
  if (!object) {
    // 先のテーブルが削除中。受け口は 404 を返す。消すか、テーブルを戻すか
    return (
      <article className="flex items-center gap-3 rounded-lg px-4 py-3 shadow-[inset_0_0_0_1px_var(--line)]">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 font-bold">
            <span className="truncate">{form.name}</span>
            <Tag color="gray">停止</Tag>
          </h3>
          <p className="text-sm text-ink-3">先のテーブル({form.object})が削除されています。受け口は 404 を返します。テーブルを元に戻すと再開します</p>
        </div>
        <IconButton label="削除" className="hover:bg-danger-wash hover:text-danger" onClick={() => remove.mutate()}>
          <Trash2 size={14} />
        </IconButton>
      </article>
    )
  }
  const endpoint = endpointOf(form)

  return (
    <article className="rounded-lg shadow-[inset_0_0_0_1px_var(--line)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <ObjectIcon icon={object.icon} color={object.color} size={16} />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 font-bold">
            <span className="truncate">{form.name}</span>
            <Tag color={form.enabled ? 'green' : 'gray'}>{form.enabled ? '受付中' : '停止'}</Tag>
          </h3>
          <p className="truncate text-sm text-ink-3">
            {object.label}に作る · {form.fields.map((k) => object.fields.find((f) => f.key === k)?.label ?? k).join('・')} · 受付 {form.submissions} 件
            {form.last_submitted_at && ` · 最終 ${formatDateTime(form.last_submitted_at)}`}
          </p>
        </div>
        <Button size="sm" onClick={() => test.mutate()} disabled={!form.enabled || test.isPending} title="見本の値で受け口へ送り、レコードができることを確かめる">
          <Send size={13} aria-hidden />
          テスト送信
        </Button>
        <IconButton label="編集" onClick={onEdit}>
          <Pencil size={14} />
        </IconButton>
        <IconButton label="鍵を作り直す" onClick={() => rotate.mutate()}>
          <RefreshCw size={14} />
        </IconButton>
        <IconButton label="削除" className="hover:bg-danger-wash hover:text-danger" onClick={() => remove.mutate()}>
          <Trash2 size={14} />
        </IconButton>
      </header>
      <div className="grid gap-3 p-4">
        <div className="flex items-center gap-2 rounded-md bg-chrome px-3 py-2">
          <span className="flex-none text-sm text-ink-2">受け口</span>
          <code className="min-w-0 flex-1 truncate font-sans text-base">{endpoint}</code>
          <IconButton label="受け口をコピー" onClick={() => void copyText(endpoint, '受け口の URL をコピーしました')}>
            <Copy size={14} />
          </IconButton>
        </div>
        <div role="tablist" aria-label="埋め込み方" className="flex gap-0.5">
          {(
            [
              ['curl', 'サーバから送る(推奨)'],
              ['html', 'ブラウザから直接送る HTML'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('h-8 rounded-md px-2.5 text-sm', tab === k ? 'bg-sunken font-bold text-ink' : 'text-ink-2 hover:text-ink')}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'html' ? (
          <Snippet title="そのまま貼れます。見た目はサイト側の CSS で。ブラウザは Access のヘッダを付けられないので、この形は受け口のパスを Access の外に出したときだけ" body={htmlSnippet(form, object)} />
        ) : (
          <Snippet title="Web サイトのサーバから、Access のサービストークン付きで転送する。JSON でも form-urlencoded でも" body={curlSnippet(form, object)} />
        )}
      </div>
    </article>
  )
}

/** Web フォーム(Salesforce の Web-to-Lead の汎用版)。受け口の URL と埋め込み用の HTML をここで出す */
export function FormsSettings() {
  const meta = useOutletContext<MetaResponse>()
  const forms = useQuery({ queryKey: ['web-forms'], queryFn: () => api.listWebForms() })
  const [editing, setEditing] = useState<{ form: WebForm | null } | null>(null)
  return (
    <>
      <SectionHeader title="Web フォーム" hint="Web サイトの問い合わせや申し込みを、そのままレコードにします。受け口の URL を埋め込むだけで、どのテーブルにも使えます">
        <Button variant="primary" onClick={() => setEditing({ form: null })}>
          <Plus size={15} strokeWidth={2.5} aria-hidden />
          フォームを作る
        </Button>
      </SectionHeader>
      <div className="grid gap-4 px-5 pb-10 md:px-8">
        {forms.data?.length === 0 && (
          <p className="rounded-lg px-4 py-8 text-center text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">まだフォームはありません。「フォームを作る」から、受け付けるテーブルと項目を選んでください</p>
        )}
        {forms.data?.map((f) => (
          <FormCard key={f.id} meta={meta} form={f} onEdit={() => setEditing({ form: f })} />
        ))}
        <details className="text-sm text-ink-2">
          <summary className="cursor-pointer text-ink">仕組み</summary>
          <ul className="mt-2 grid gap-1 pl-5">
            <li>受け口はアプリの認証なしの POST。form-urlencoded でも JSON でも受け、受け付ける項目に無い列は捨てます。経路は画面と同じ(Cloudflare Access の内側)なので、送るのは Web サイトのサーバで、Access のサービストークンをヘッダに付けます(06 §7)</li>
            <li>既定値を足してから、画面からの作成と同じ経路(検証・業務ルール)でレコードを作ります</li>
            <li>bot 対策: 人には見えない欄(<code>_gotcha</code>)が埋まっていたら捨てます。多すぎる送信は受け口ごとに間引きます(バックエンドで。J-039)</li>
            <li>鍵を作り直すと古い URL は効かなくなります。漏れたときに</li>
          </ul>
        </details>
      </div>
      {editing && <FormEditor meta={meta} form={editing.form} onClose={() => setEditing(null)} />}
    </>
  )
}
