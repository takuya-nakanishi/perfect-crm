import { ApiError, type ApiClient } from '@/api/client'
import type { Session } from '@/api/types'
import * as db from './engine'

const SESSION_KEY = 'works.mock.session'
/** 通信の待ち時間を模す。0 にしないのは、楽観更新や読み込み中の見え方を本番に近づけるため */
const READ_MS = 40
const WRITE_MS = 120

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function currentSession(): Session | null {
  try {
    const saved = localStorage.getItem(SESSION_KEY)
    if (!saved) return null
    const { user_id } = JSON.parse(saved) as { user_id: string }
    const user = db.users.find((u) => u.id === user_id)
    return user ? { user, workspace: db.workspace } : null
  } catch {
    return null
  }
}

function requireUser(): string {
  const session = currentSession()
  if (!session) throw new ApiError(401, 'unauthorized', 'ログインが必要です')
  return session.user.id
}

function notFound(): never {
  throw new ApiError(404, 'not_found', 'レコードが見つかりません')
}

export function createMockClient(): ApiClient {
  return {
    async getSession() {
      await sleep(READ_MS)
      return currentSession()
    },
    async login(email, password) {
      await sleep(WRITE_MS * 3)
      if (!email.trim() || !password) throw new ApiError(400, 'invalid', 'メールアドレスとパスワードを入力してください')
      // モックでは誰でも通す。入力したメールの利用者がいればその人、いなければ最初の利用者
      const user = db.users.find((u) => u.email === email.trim().toLowerCase()) ?? db.users[0]
      localStorage.setItem(SESSION_KEY, JSON.stringify({ user_id: user.id }))
      return { user, workspace: db.workspace }
    },
    async logout() {
      await sleep(READ_MS)
      localStorage.removeItem(SESSION_KEY)
    },

    async getMeta() {
      await sleep(READ_MS)
      requireUser()
      return structuredClone({ workspace: db.workspace, objects: db.objects, views: db.views, users: db.users })
    },

    async listRecords(object, params = {}) {
      await sleep(READ_MS)
      return db.query(object, params, requireUser())
    },
    async getRecord(object, id) {
      await sleep(READ_MS)
      requireUser()
      return db.find(object, id) ?? notFound()
    },
    async createRecord(object, values) {
      await sleep(WRITE_MS)
      return db.insert(object, values, requireUser())
    },
    async updateRecord(object, id, patch) {
      await sleep(WRITE_MS)
      requireUser()
      return db.update(object, id, patch) ?? notFound()
    },
    async deleteRecord(object, id) {
      await sleep(WRITE_MS)
      requireUser()
      if (!db.remove(object, id)) notFound()
    },
    async restoreRecord(object, row) {
      await sleep(WRITE_MS)
      requireUser()
      return db.restore(object, row)
    },

    async aggregate(object, params) {
      await sleep(READ_MS)
      return { rows: db.aggregate(object, params, requireUser()) }
    },
    async search(q) {
      await sleep(READ_MS)
      requireUser()
      return { hits: db.searchAll(q) }
    },
  }
}

/** モックのデータを初期状態へ戻す(利用者メニューから呼ぶ) */
export function resetMockData() {
  db.resetTables()
}
