import type {
  AggregateParams,
  AggregateResponse,
  ListParams,
  ListResponse,
  MetaResponse,
  RecordResponse,
  Row,
  Scalar,
  SearchResponse,
  Session,
} from './types'

/**
 * 画面が使う唯一の窓口。実装は 2 つ:
 * - mock: ブラウザ内の擬似 DB(src/mocks)。バックエンド無しで画面が完結する
 * - http: Python バックエンドの /api/v1 を叩く(src/api/http.ts)
 * 切り替えは環境変数 VITE_API_MODE(既定 mock)。
 */
export interface ApiClient {
  getSession(): Promise<Session | null>
  login(email: string, password: string): Promise<Session>
  logout(): Promise<void>

  getMeta(): Promise<MetaResponse>

  listRecords(object: string, params?: ListParams): Promise<ListResponse>
  getRecord(object: string, id: string): Promise<RecordResponse>
  createRecord(object: string, values: Record<string, Scalar>): Promise<RecordResponse>
  updateRecord(object: string, id: string, patch: Record<string, Scalar>): Promise<RecordResponse>
  deleteRecord(object: string, id: string): Promise<void>
  /** 削除の取り消し(モックでは行をそのまま戻す。本番は論理削除の解除) */
  restoreRecord(object: string, row: Row): Promise<RecordResponse>

  aggregate(object: string, params: AggregateParams): Promise<AggregateResponse>
  search(q: string): Promise<SearchResponse>
}

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const API_MODE: 'mock' | 'http' = import.meta.env.VITE_API_MODE === 'http' ? 'http' : 'mock'

let instance: Promise<ApiClient> | null = null

/** 実装は動的 import。http モードのビルドにモックのデータを含めない */
export function getApi(): Promise<ApiClient> {
  instance ??=
    API_MODE === 'http'
      ? import('./http').then((m) => m.createHttpClient())
      : import('@/mocks/mockClient').then((m) => m.createMockClient())
  return instance
}

/** 呼び出し側を短くするための薄い包み。api.listRecords(...) のように使う */
export const api: ApiClient = new Proxy({} as ApiClient, {
  get(_target, prop: keyof ApiClient) {
    return (...args: unknown[]) =>
      getApi().then((client) => (client[prop] as (...a: unknown[]) => unknown)(...args))
  },
})
