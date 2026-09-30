import { RotateCw } from 'lucide-react'
import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/basics'
import { CloverMark } from './CloverMark'

/**
 * 描いている途中で例外が出たときの受け皿。これが無いと React は画面を丸ごと外し、真っ白になる
 * (何が起きたかも、どうすればよいかも分からない)。例外の中身は、直すときの手がかりとして画面に出す。
 * コンソールへは React が出す(受け止めた例外も console.error に流れる)
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="grid min-h-dvh place-items-center bg-chrome px-5 py-10 text-ink">
        <main className="w-full max-w-[420px] rounded-xl bg-paper p-6 shadow-card sm:p-8">
          <div className="flex items-center gap-2.5">
            <CloverMark size={26} />
            <span className="text-lg font-bold tracking-tight">Works</span>
          </div>
          <h1 className="mt-8 text-xl font-bold tracking-tight">画面を表示できませんでした</h1>
          <p className="mt-2 text-ink-2">保存済みのデータは消えていません。再読み込みしてください。</p>
          <p role="alert" className="mt-4 rounded-lg bg-danger-wash px-3 py-2 text-sm wrap-break-word text-danger">
            {error.message || String(error)}
          </p>
          <Button variant="primary" className="mt-6" onClick={() => location.reload()}>
            <RotateCw size={14} aria-hidden />
            再読み込み
          </Button>
        </main>
      </div>
    )
  }
}
