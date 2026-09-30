/**
 * Slack のチャンネルの擬似(04 §14)。本番はバックエンドの `slack_connections`(1 行 = 1 チャンネル)。
 * モックには Slack の許可の画面が無いので、「繋ぐ」で架空のワークスペースのチャンネルを 1 つ足したことにして、
 * 頼まれた画面へ戻す(本物は Slack の許可の画面を経て戻る)。送ったことは最終送信の時刻にだけ残す
 */
import { ApiError } from '@/api/client'
import type { SlackChannel, SlackStatus } from '@/api/types'

const STORAGE_KEY = 'works.mock.slack.v1'
/** 許可のあとに戻す画面。環境設定の中だけ(外の URL へは戻さない。本番の `RETURN_PATTERN` と同じ) */
const RETURN_PATTERN = /^\/settings(\/[a-z][a-z-]*)*$/
export const DEFAULT_RETURN = '/settings/slack'
/** 架空のワークスペースのチャンネル。繋ぐたびに、まだ繋いでいない名前を順に使う */
const DEMO_CHANNELS = ['#web-問い合わせ', '#営業', '#リード', '#全社']

let channels: SlackChannel[] = load()

function load(): SlackChannel[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved) as SlackChannel[]
  } catch {
    // 壊れていたら空から
  }
  return []
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(channels))
  } catch {
    // 保存できなくても画面は動かす
  }
}

export function resetSlack() {
  localStorage.removeItem(STORAGE_KEY)
  channels = load()
}

export function slackStatus(): SlackStatus {
  return { configured: true, channels: structuredClone(channels) }
}

export function findChannel(id: string | null | undefined): SlackChannel | null {
  return channels.find((c) => c.id === id) ?? null
}

export function returnPath(value: string | undefined): string {
  return value && RETURN_PATTERN.test(value) ? value : DEFAULT_RETURN
}

/** 「繋ぐ」。本物は Slack の許可の画面の URL を返し、戻り(`/slack/callback`)でチャンネルを仕舞う */
export function slackConnect(me: string, returnTo?: string): { url: string } {
  const name = DEMO_CHANNELS.find((n) => !channels.some((c) => c.channel_name === n)) ?? `#チャンネル-${channels.length + 1}`
  const channel: SlackChannel = {
    id: crypto.randomUUID(),
    team_name: 'Works デモ',
    channel_name: name,
    configuration_url: null,
    connected_by: me,
    connected_at: new Date().toISOString(),
    last_sent_at: null,
    last_error: null,
    last_error_at: null,
    needs_reconnect: false,
  }
  channels.push(channel)
  save()
  return { url: `${returnPath(returnTo)}?${new URLSearchParams({ slack: 'connected', channel: channel.id })}` }
}

/** 送った結果を残す。送れたら前の失敗を消す(「要再接続」も消える) */
export function recordSent(id: string) {
  const c = findChannel(id)
  if (!c) return
  Object.assign(c, { last_sent_at: new Date().toISOString(), last_error: null, last_error_at: null, needs_reconnect: false })
  save()
}

/** 投稿先が失われたことにする(モックのテストで「要再接続」を作るため。本物は Slack の応答で決まる) */
export function breakChannel(id: string, code = 'channel_not_found') {
  const c = findChannel(id)
  if (!c) return
  Object.assign(c, {
    last_error: `投稿先が使えなくなりました(${code})。環境設定の Slack から、このチャンネルを繋ぎ直してください`,
    last_error_at: new Date().toISOString(),
    needs_reconnect: true,
  })
  save()
}

export function slackTest(id: string): SlackStatus {
  const c = findChannel(id)
  if (!c) throw new ApiError(404, 'not_found', 'チャンネルがありません')
  // モックは届いたことにする(要再接続のチャンネルも、テスト通知が届けば直ったとみなす)
  recordSent(id)
  return slackStatus()
}

/** 外す(Works が Webhook を捨てるだけ)。使っているワークフローの確かめは呼ぶ側(workflows.ts)が先に行う */
export function removeChannel(id: string) {
  const before = channels.length
  channels = channels.filter((c) => c.id !== id)
  if (channels.length === before) throw new ApiError(404, 'not_found', 'チャンネルがありません')
  save()
}
