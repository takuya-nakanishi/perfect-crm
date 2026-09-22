/**
 * 環境設定の擬似: MCP のアクセストークンと Web フォーム。本番はバックエンドの表(mcp_tokens / web_forms)。
 * トークンの全文は発行時に 1 回だけ返し、保存するのはハッシュだけ(ここでは先頭 8 文字と印のみ)
 */
import { ApiError } from '@/api/client'
import type { McpToken, McpTokenCreated, RecordResponse, Scalar, WebForm, WebFormInput } from '@/api/types'
import { coerce } from './csv'
import { insert, users } from './engine'
import { liveObjects } from './schema'

const STORAGE_KEY = 'works.mock.settings.v1'

interface Store {
  tokens: McpToken[]
  forms: WebForm[]
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000).toISOString()

function seed(): Store {
  const me = users[0].id
  return {
    tokens: [
      { id: 'tok-0001', name: 'Surface の Claude Desktop', client: 'claude-desktop', prefix: 'wks_a3f9', created_by: me, created_at: hoursAgo(24 * 6), last_used_at: hoursAgo(2) },
      { id: 'tok-0002', name: 'WSL の Claude Code', client: 'claude-code', prefix: 'wks_7c21', created_by: me, created_at: hoursAgo(24 * 3), last_used_at: hoursAgo(26) },
    ],
    forms: [
      {
        id: 'form-0001',
        name: 'Web サイトのお問い合わせ',
        object: 'contacts',
        fields: ['name', 'email', 'phone', 'description'],
        defaults: { status: 'new' },
        key: 'k8f2m1qz7x',
        enabled: true,
        redirect_url: null,
        created_at: hoursAgo(24 * 10),
        submissions: 12,
        last_submitted_at: hoursAgo(31),
      },
    ],
  }
}

function load(): Store {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved) as Store
  } catch {
    // 壊れていたら作り直す
  }
  return seed()
}

let store: Store = load()

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // 保存できなくても画面は動かす
  }
}

export function resetSettings() {
  localStorage.removeItem(STORAGE_KEY)
  store = load()
}

export function requireAdmin(userId: string) {
  if (!users.find((u) => u.id === userId)?.admin) throw new ApiError(403, 'forbidden', '環境設定は管理者だけが使えます')
}

const random = (n: number) => {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(n))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

// --- MCP ---------------------------------------------------------------------

export function listTokens(): McpToken[] {
  return structuredClone(store.tokens)
}

export function createToken(name: string, client: McpToken['client'], me: string): McpTokenCreated {
  if (!name.trim()) throw new ApiError(400, 'invalid', 'トークンの名前を入力してください')
  const secret = `wks_${random(40)}`
  const token: McpToken = { id: crypto.randomUUID(), name: name.trim(), client, prefix: secret.slice(0, 8), created_by: me, created_at: new Date().toISOString(), last_used_at: null }
  store.tokens.unshift(token)
  save()
  return { token: structuredClone(token), secret }
}

export function revokeToken(id: string) {
  const before = store.tokens.length
  store.tokens = store.tokens.filter((t) => t.id !== id)
  if (store.tokens.length === before) throw new ApiError(404, 'not_found', 'トークンがありません')
  save()
}

// --- Web フォーム ---------------------------------------------------------------

function checkForm(input: WebFormInput) {
  if (!input.name.trim()) throw new ApiError(400, 'invalid', 'フォームの名前を入力してください')
  const meta = liveObjects().find((o) => o.key === input.object)
  if (!meta) throw new ApiError(400, 'invalid', 'テーブルを選んでください')
  if (input.fields.length === 0) throw new ApiError(400, 'invalid', '受け付ける項目を 1 つ以上選んでください')
  for (const k of input.fields) {
    const f = meta.fields.find((x) => x.key === k)
    if (!f || f.readonly || f.type === 'polymorphic' || f.type === 'drive_files') throw new ApiError(400, 'invalid', `受け付けられない項目です: ${k}`)
  }
  if (input.redirect_url && !/^https?:\/\//.test(input.redirect_url)) throw new ApiError(400, 'invalid', '戻り先の URL は http(s) で始めてください')
}

export function listForms(): WebForm[] {
  return structuredClone(store.forms)
}

export function createForm(input: WebFormInput): WebForm {
  checkForm(input)
  const form: WebForm = { ...structuredClone(input), name: input.name.trim(), id: crypto.randomUUID(), key: random(10), created_at: new Date().toISOString(), submissions: 0, last_submitted_at: null }
  store.forms.unshift(form)
  save()
  return structuredClone(form)
}

export function updateForm(id: string, input: WebFormInput): WebForm {
  checkForm(input)
  const i = store.forms.findIndex((f) => f.id === id)
  if (i < 0) throw new ApiError(404, 'not_found', 'フォームがありません')
  store.forms[i] = { ...store.forms[i], ...structuredClone(input), name: input.name.trim() }
  save()
  return structuredClone(store.forms[i])
}

export function deleteForm(id: string) {
  store.forms = store.forms.filter((f) => f.id !== id)
  save()
}

export function rotateKey(id: string): WebForm {
  const form = store.forms.find((f) => f.id === id)
  if (!form) throw new ApiError(404, 'not_found', 'フォームがありません')
  form.key = random(10)
  save()
  return structuredClone(form)
}

/** 受け口。fields に無い列は捨て、defaults を足してから、ふつうの作成と同じ経路(検証・業務ルール)を通す */
export function submitForm(key: string, values: Record<string, Scalar>): RecordResponse {
  const form = store.forms.find((f) => f.key === key && f.enabled)
  if (!form) throw new ApiError(404, 'not_found', 'このフォームは受け付けていません')
  // テーブルが削除中なら受けない(定義の画面でも「停止」として見せる)
  const meta = liveObjects().find((o) => o.key === form.object)
  if (!meta) throw new ApiError(404, 'not_found', 'このフォームの先のテーブルがありません')
  // bot 避け: 人には見えない欄が埋まっていたら、成功に見せて何もしない(04 §10 の 3)。
  // レコードも submissions も増やさず、id だけの空の応答を返す(弾かれたと bot に気づかせない)
  if (typeof values._gotcha === 'string' && values._gotcha) {
    const now = new Date().toISOString()
    return { record: { id: crypto.randomUUID(), created_at: now, updated_at: now }, references: {} }
  }
  const accepted: Record<string, Scalar> = { ...form.defaults }
  for (const k of form.fields) {
    if (!(k in values)) continue
    const field = meta.fields.find((f) => f.key === k)
    if (!field) continue
    const v = values[k]
    // form-urlencoded は全部が文字で届く。項目の型に直してから、ふつうの作成と同じ検証を通す
    try {
      accepted[k] = typeof v === 'string' ? coerce(field, v) : v
    } catch (e) {
      throw new ApiError(400, 'invalid', e instanceof Error ? e.message : String(e))
    }
  }
  const created = insert(form.object, accepted, null)
  form.submissions += 1
  form.last_submitted_at = new Date().toISOString()
  save()
  return created
}
