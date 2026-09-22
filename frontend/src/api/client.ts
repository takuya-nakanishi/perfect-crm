import type {
  AggregateParams,
  AggregateResponse,
  DriveFile,
  ImportParams,
  ImportResponse,
  ListParams,
  McpToken,
  McpTokenCreated,
  ListResponse,
  MetaResponse,
  ObjectInput,
  RecordResponse,
  Row,
  ViewInput,
  Scalar,
  SearchResponse,
  Session,
  TimelineResponse,
  WebForm,
  WebFormInput,
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
  /** テーブル設定。どれも変更後のメタデータ全体を返す(画面はそれをそのまま差し替える) */
  createObject(input: ObjectInput): Promise<MetaResponse>
  updateObject(key: string, input: ObjectInput): Promise<MetaResponse>
  /** 論理削除。レコードとビューは残り、restoreObject で戻せる */
  deleteObject(key: string): Promise<MetaResponse>
  restoreObject(key: string): Promise<MetaResponse>
  /** サイドバーの並び。keys の順に position を振り直す */
  reorderObjects(keys: string[]): Promise<MetaResponse>
  /** ビュー(タブ)。どれも変更後のメタデータ全体を返す */
  createView(object: string, input: ViewInput): Promise<MetaResponse>
  updateView(id: string, input: ViewInput): Promise<MetaResponse>
  /** 論理削除。restoreView で戻せる */
  deleteView(id: string): Promise<MetaResponse>
  restoreView(id: string): Promise<MetaResponse>
  /** タブの並び。ids の順に position を振り直す */
  reorderViews(object: string, ids: string[]): Promise<MetaResponse>

  listRecords(object: string, params?: ListParams): Promise<ListResponse>
  getRecord(object: string, id: string): Promise<RecordResponse>
  createRecord(object: string, values: Record<string, Scalar>): Promise<RecordResponse>
  updateRecord(object: string, id: string, patch: Record<string, Scalar>): Promise<RecordResponse>
  deleteRecord(object: string, id: string): Promise<void>
  /** 削除の取り消し(モックでは行をそのまま戻す。本番は論理削除の解除) */
  restoreRecord(object: string, row: Row): Promise<RecordResponse>

  aggregate(object: string, params: AggregateParams): Promise<AggregateResponse>
  /** レコードの時系列(活動 + 言及 + 完了したタスク)。新しい順、100 件まで */
  getTimeline(object: string, id: string): Promise<TimelineResponse>
  importRecords(object: string, params: ImportParams): Promise<ImportResponse>

  /** 環境設定(管理者だけ。03 §5)。MCP のトークンと Web フォーム */
  listMcpTokens(): Promise<McpToken[]>
  createMcpToken(name: string, client: McpToken['client']): Promise<McpTokenCreated>
  revokeMcpToken(id: string): Promise<void>
  listWebForms(): Promise<WebForm[]>
  createWebForm(input: WebFormInput): Promise<WebForm>
  updateWebForm(id: string, input: WebFormInput): Promise<WebForm>
  deleteWebForm(id: string): Promise<void>
  /** 鍵を作り直す(古い URL は効かなくなる) */
  rotateWebFormKey(id: string): Promise<WebForm>
  /** 受け口そのもの(認証なし)。画面からは「テスト送信」で使う */
  submitWebForm(key: string, values: Record<string, Scalar>): Promise<RecordResponse>

  /** Google ドライブ(ログインしている利用者のアカウント)。マイドライブのファイルを探す */
  listDriveFiles(q: string): Promise<DriveFile[]>
  /**
   * 「マイドライブ / CRM / テーブル名 / レコード名」の Google ドキュメントを作り、その項目に付ける。
   * フォルダが無ければ作る。応答は更新後のレコード
   */
  createDriveDocument(object: string, id: string, field: string): Promise<RecordResponse>
  /** CSV(UTF-8、BOM 付き)。見出しは項目名、選択肢はラベル、参照は表示名 */
  exportRecords(object: string, params?: ListParams): Promise<Blob>
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
