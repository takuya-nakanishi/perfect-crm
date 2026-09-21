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

    // フィルタと並びは入れ子になるので、クエリ文字列ではなく POST の本文で渡す
    listRecords: (object, params = {}) => request('POST', `/objects/${enc(object)}/records/query`, params),
    getRecord: (object, id) => request('GET', `/objects/${enc(object)}/records/${enc(id)}`),
    createRecord: (object, values) => request('POST', `/objects/${enc(object)}/records`, values),
    updateRecord: (object, id, patch) => request('PATCH', `/objects/${enc(object)}/records/${enc(id)}`, patch),
    deleteRecord: (object, id) => request('DELETE', `/objects/${enc(object)}/records/${enc(id)}`),
    restoreRecord: (object, row) => request('POST', `/objects/${enc(object)}/records/${enc(row.id)}/restore`),

    aggregate: (object, params) => request('POST', `/objects/${enc(object)}/aggregate`, params),
    search: (q) => request('GET', `/search?q=${enc(q)}`),
  }
}
