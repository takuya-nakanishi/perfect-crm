import { useRef, useState } from 'react'
import type { MetaResponse, References, RefRecord, Row, Scalar } from '@/api/types'
import { Button, ObjectIcon } from '@/components/ui/basics'
import { Modal } from '@/components/ui/overlay'
import { useCreateRecord } from '@/data/mutations'
import { findObject } from '@/data/queries'
import { isEmptyValue } from '@/lib/records'
import { usePeek } from '@/lib/usePeek'
import { useUI } from '@/state/ui'
import { FieldEditor } from './FieldEditor'

/** レコードの新規作成(N)。フォームの項目はメタデータから組み立てる */
export function CreateRecordModal({
  meta,
  objectKey,
  defaults,
  defaultRefs,
}: {
  meta: MetaResponse
  objectKey: string
  defaults: Record<string, Scalar>
  defaultRefs: Record<string, RefRecord>
}) {
  const close = useUI((s) => s.closeCreate)
  const toast = useUI((s) => s.toast)
  const create = useCreateRecord()
  const { openPeek } = usePeek()
  const object = findObject(meta, objectKey)

  const [values, setValues] = useState<Record<string, Scalar>>(() => {
    // 必須の選択肢は、先頭の値を最初から選んでおく(サーバの既定値と同じ。見えているものがそのまま保存される)
    const init: Record<string, Scalar> = {}
    for (const f of object?.fields ?? []) {
      if (f.type === 'select' && f.required && f.options?.[0]) init[f.key] = f.options[0].value
    }
    return { ...init, ...defaults }
  })
  const [refs, setRefs] = useState<References>(() => {
    // 既定値に入れた参照(「この取引先の商談を追加」など)の表示名を、最初から出す
    const init: References = {}
    for (const [fieldKey, ref] of Object.entries(defaultRefs)) {
      const target = object?.fields.find((f) => f.key === fieldKey)?.target
      if (target) init[target] = { ...init[target], [ref.id]: ref }
    }
    return init
  })
  const [showErrors, setShowErrors] = useState(false)
  const valuesRef = useRef(values)
  if (!object) return null

  // ドライブのファイルは、レコードができてから付ける(ドキュメントの名前にレコード名を使うため)
  const fields = object.fields.filter((f) => !f.readonly && f.in_create_form !== false && f.type !== 'drive_files')
  const draft: Row = { id: 'draft', ...values }
  const missingIn = (v: Record<string, Scalar>) =>
    fields.filter((f) => f.required && f.type !== 'select' && isEmptyValue(f, { id: 'draft', ...v }))
  const missing = missingIn(values)

  const submit = () => {
    // Ctrl+Enter では直前の確定(blur)の結果をまだ描画していないことがあるので、最新の値を ref から読む
    const latest = valuesRef.current
    if (missingIn(latest).length > 0) {
      setShowErrors(true)
      return
    }
    // mutate に渡す onSuccess は、この画面を閉じた(unmount した)あとには呼ばれない。閉じたあとに知らせたいので Promise で受ける。
    // 失敗はフック側(useCreateRecord)が知らせる
    create
      .mutateAsync({ object: object.key, values: latest })
      .then((res) => toast({ message: `${object.label}を作成しました`, action: { label: '開く', run: () => openPeek(object.key, res.record.id) } }))
      .catch(() => {})
    close()
  }

  return (
    <Modal label={`${object.label}を作成`} onClose={close} className="max-w-[560px]">
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
            e.preventDefault()
            // 入力中の欄を確定させてから送る
            ;(document.activeElement as HTMLElement | null)?.blur()
            setTimeout(submit, 0)
          }
        }}
      >
        <header className="flex flex-none items-center gap-2 px-5 pt-5 pb-3">
          <ObjectIcon icon={object.icon} color={object.color} size={16} />
          <h2 className="text-lg font-bold">{object.label}を作成</h2>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 overflow-y-auto px-5 pb-5">
          {fields.map((f, i) => {
            const invalid = showErrors && missing.includes(f)
            return (
              <div key={f.key} className="contents">
                <label className="flex h-8 items-center text-ink-2">
                  {f.label}
                  {f.required && f.type !== 'select' && <span className="ml-1 text-danger" aria-label="必須">*</span>}
                </label>
                <div className="min-w-0">
                  <FieldEditor
                    meta={meta}
                    object={object}
                    field={f}
                    row={draft}
                    references={refs}
                    variant="form"
                    autoFocus={i === 0}
                    onCommit={(patch, extra) => {
                      valuesRef.current = { ...valuesRef.current, ...patch }
                      setValues(valuesRef.current)
                      if (extra) setRefs((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { ...prev[k], ...v }])) }))
                    }}
                  />
                  {invalid && <p className="mt-1 text-sm text-danger">{f.label}を入力してください</p>}
                </div>
              </div>
            )
          })}
        </div>

        <footer className="flex flex-none items-center justify-end gap-2 border-t border-line bg-chrome px-5 py-3">
          <Button variant="ghost" onClick={close}>
            キャンセル
          </Button>
          <Button
            variant="primary"
            type="submit"
            // 送る前に、入力中の欄(フォーカスが外れたときに確定する)を確定させる
            onMouseDown={() => (document.activeElement as HTMLElement | null)?.blur()}
          >
            {object.label}を作成
          </Button>
        </footer>
      </form>
    </Modal>
  )
}
