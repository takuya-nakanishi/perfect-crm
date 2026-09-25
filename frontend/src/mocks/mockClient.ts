import { ApiError, type ApiClient } from '@/api/client'
import type { Session } from '@/api/types'
import { exportCsv, importCsv } from './csv'
import { connectDrive, createDocument, disconnectDrive, driveStatus, listFiles, resetDrive } from './drive'
import * as settings from './settings'
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
      return db.getMeta()
    },
    async createObject(input) {
      await sleep(WRITE_MS)
      // テーブルの定義は管理者だけ(03 §5)。ビューは誰でも(共有ビューと個人ビューの区別は J-038)
      settings.requireAdmin(requireUser())
      return db.createObject(input)
    },
    async updateObject(key, input) {
      await sleep(WRITE_MS)
      // テーブルの定義は管理者だけ(03 §5)。ビューは誰でも(共有ビューと個人ビューの区別は J-038)
      settings.requireAdmin(requireUser())
      return db.updateObject(key, input)
    },
    async deleteObject(key) {
      await sleep(WRITE_MS)
      // テーブルの定義は管理者だけ(03 §5)。ビューは誰でも(共有ビューと個人ビューの区別は J-038)
      settings.requireAdmin(requireUser())
      return db.deleteObject(key)
    },
    async restoreObject(key) {
      await sleep(WRITE_MS)
      // テーブルの定義は管理者だけ(03 §5)。ビューは誰でも(共有ビューと個人ビューの区別は J-038)
      settings.requireAdmin(requireUser())
      return db.restoreObject(key)
    },
    async saveSidebar(items) {
      await sleep(WRITE_MS)
      // サイドバーの並びとフォルダはワークスペース共通なので、管理者だけ(03 §5。利用者ごとに持つかは Q-045)
      settings.requireAdmin(requireUser())
      return db.saveSidebar(items)
    },
    async createView(object, input) {
      await sleep(WRITE_MS)
      requireUser()
      return db.createView(object, input)
    },
    async updateView(id, input) {
      await sleep(WRITE_MS)
      requireUser()
      return db.updateView(id, input)
    },
    async deleteView(id) {
      await sleep(WRITE_MS)
      requireUser()
      return db.deleteView(id)
    },
    async restoreView(id) {
      await sleep(WRITE_MS)
      requireUser()
      return db.restoreView(id)
    },
    async reorderViews(object, ids) {
      await sleep(WRITE_MS)
      requireUser()
      return db.reorderViews(object, ids)
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
      return db.update(object, id, patch, requireUser()) ?? notFound()
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
    async getTimeline(object, id) {
      await sleep(READ_MS)
      requireUser()
      return { entries: db.timeline(object, id) }
    },
    async importRecords(object, params) {
      await sleep(WRITE_MS)
      return importCsv(object, params, requireUser())
    },
    async listMcpTokens() {
      await sleep(READ_MS)
      settings.requireAdmin(requireUser())
      return settings.listTokens()
    },
    async createMcpToken(name, client) {
      await sleep(WRITE_MS)
      const me = requireUser()
      settings.requireAdmin(me)
      return settings.createToken(name, client, me)
    },
    async revokeMcpToken(id) {
      await sleep(WRITE_MS)
      settings.requireAdmin(requireUser())
      settings.revokeToken(id)
    },
    async listMcpConnections() {
      await sleep(READ_MS)
      settings.requireAdmin(requireUser())
      return settings.listConnections()
    },
    async revokeMcpConnection(id) {
      await sleep(WRITE_MS)
      settings.requireAdmin(requireUser())
      settings.revokeConnection(id)
    },
    async getOAuthRequest(id) {
      await sleep(READ_MS)
      requireUser()
      return settings.getRequest(id)
    },
    async decideOAuthRequest(id, approve) {
      await sleep(WRITE_MS)
      return settings.decideRequest(id, approve, requireUser())
    },
    async listWebForms() {
      await sleep(READ_MS)
      settings.requireAdmin(requireUser())
      return settings.listForms()
    },
    async createWebForm(input) {
      await sleep(WRITE_MS)
      settings.requireAdmin(requireUser())
      return settings.createForm(input)
    },
    async updateWebForm(id, input) {
      await sleep(WRITE_MS)
      settings.requireAdmin(requireUser())
      return settings.updateForm(id, input)
    },
    async deleteWebForm(id) {
      await sleep(WRITE_MS)
      settings.requireAdmin(requireUser())
      settings.deleteForm(id)
    },
    async rotateWebFormKey(id) {
      await sleep(WRITE_MS)
      settings.requireAdmin(requireUser())
      return settings.rotateKey(id)
    },
    async submitWebForm(key, values) {
      await sleep(WRITE_MS)
      // 受け口は認証なし(公開の Web から呼ばれる)
      return settings.submitForm(key, values)
    },
    async googleStatus() {
      await sleep(READ_MS)
      requireUser()
      return driveStatus()
    },
    async googleConnect() {
      await sleep(READ_MS)
      requireUser()
      return connectDrive()
    },
    async googleDisconnect() {
      await sleep(WRITE_MS)
      requireUser()
      disconnectDrive()
    },
    async listDriveFiles(q) {
      await sleep(READ_MS * 3)
      requireUser()
      return listFiles(q)
    },
    async createDriveDocument(object, id, field) {
      await sleep(WRITE_MS * 4)
      return createDocument(object, id, field, requireUser())
    },
    async exportRecords(object, params = {}) {
      await sleep(READ_MS)
      return exportCsv(object, params, requireUser())
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
  resetDrive()
  settings.resetSettings()
}
