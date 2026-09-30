import type { WorkflowInput } from '@/api/types'

/**
 * Slack の許可の画面へ出て戻るあいだ、書きかけのワークフローを預かる(ページごと移るので、画面の状態は消える)。
 * 戻ったら 1 回だけ取り出し、足したチャンネルをそのアクションに入れて編集を続ける
 */
const KEY = 'works.workflow.resume'

export interface Resume {
  /** 直していたワークフロー(新しく作っていたなら null) */
  id: string | null
  draft: WorkflowInput
  /** チャンネルを足そうとしたアクション */
  actionId: string
}

export function saveResume(resume: Resume) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(resume))
  } catch {
    // 預けられなくても、チャンネルは足せる(書きかけはやり直し)
  }
}

export function takeResume(): Resume | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return raw ? (JSON.parse(raw) as Resume) : null
  } catch {
    return null
  }
}
