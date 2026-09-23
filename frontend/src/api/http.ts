import { ApiError, type ApiClient } from './client'
import type { ApiErrorBody } from './types'

/**
 * Python バックエンド向けの実装。エンドポイントの一覧は docs/design/04-api.md と対で保つ。
 * 認証はセッション Cookie(同一オリジン)。
 */
const BASE = '/api/v1'

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiErrorBody>
    throw new ApiError(res.status, err.code ?? 'error', err.message ?? `HTTP ${res.status}`)
  }
  return data as T
}

const enc = encodeURIComponent

export function createHttpClient(): ApiClient {
  return {
    getSession: () =>
      request<Awaited<ReturnType<ApiClient['getSession']>>>('GET', '/session').catch((e) => {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }),
    login: (email, password) => request('POST', '/session', { email, password }),
    logout: () => request('DELETE', '/session'),

    getMeta: () => request('GET', '/meta'),
    createObject: (input) => request('POST', '/meta/objects', input),
    updateObject: (key, input) => request('PUT', `/meta/objects/${enc(key)}`, input),
    deleteObject: (key) => request('DELETE', `/meta/objects/${enc(key)}`),
    restoreObject: (key) => request('POST', `/meta/objects/${enc(key)}/restore`),
    reorderObjects: (keys) => request('PUT', '/meta/objects/order', { keys }),
    createView: (object, input) => request('POST', '/meta/views', { object, ...input }),
    updateView: (id, input) => request('PUT', `/meta/views/${enc(id)}`, input),
    deleteView: (id) => request('DELETE', `/meta/views/${enc(id)}`),
    restoreView: (id) => request('POST', `/meta/views/${enc(id)}/restore`),
    reorderViews: (object, ids) => request('PUT', '/meta/views/order', { object, ids }),

    // フィルタと並びは入れ子になるので、クエリ文字列ではなく POST の本文で渡す
    listRecords: (object, params = {}) => request('POST', `/objects/${enc(object)}/records/query`, params),
    getRecord: (object, id) => request('GET', `/objects/${enc(object)}/records/${enc(id)}`),
    createRecord: (object, values) => request('POST', `/objects/${enc(object)}/records`, values),
    updateRecord: (object, id, patch) => request('PATCH', `/objects/${enc(object)}/records/${enc(id)}`, patch),
    deleteRecord: (object, id) => request('DELETE', `/objects/${enc(object)}/records/${enc(id)}`),
    restoreRecord: (object, row) => request('POST', `/objects/${enc(object)}/records/${enc(row.id)}/restore`),

    aggregate: (object, params) => request('POST', `/objects/${enc(object)}/aggregate`, params),
    getTimeline: (object, id) => request('GET', `/objects/${enc(object)}/records/${enc(id)}/timeline`),
    importRecords: (object, params) => request('POST', `/objects/${enc(object)}/import`, params),
    listMcpTokens: () => request('GET', '/settings/mcp/tokens'),
    createMcpToken: (name, client) => request('POST', '/settings/mcp/tokens', { name, client }),
    revokeMcpToken: (id) => request('DELETE', `/settings/mcp/tokens/${enc(id)}`),
    listWebForms: () => request('GET', '/settings/forms'),
    createWebForm: (input) => request('POST', '/settings/forms', input),
    updateWebForm: (id, input) => request('PUT', `/settings/forms/${enc(id)}`, input),
    deleteWebForm: (id) => request('DELETE', `/settings/forms/${enc(id)}`),
    rotateWebFormKey: (id) => request('POST', `/settings/forms/${enc(id)}/rotate`),
    submitWebForm: (key, values) => request('POST', `/forms/${enc(key)}`, values),
    googleStatus: () => request('GET', '/google/status'),
    googleConnect: () => request('POST', '/google/connect'),
    googleDisconnect: () => request('DELETE', '/google/connection'),
    listDriveFiles: (q) => request('GET', `/drive/files?q=${enc(q)}`),
    createDriveDocument: (object, id, field) => request('POST', `/objects/${enc(object)}/records/${enc(id)}/drive/${enc(field)}/document`),
    exportRecords: async (object, params = {}) => {
      const res = await fetch(`${BASE}/objects/${enc(object)}/export`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new ApiError(res.status, 'error', `HTTP ${res.status}`)
      return res.blob()
    },
    search: (q) => request('GET', `/search?q=${enc(q)}`),
  }
}
