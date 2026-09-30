import { Copy, Smartphone } from 'lucide-react'
import type { ChangeEvent, Ref } from 'react'
import type { TotpSetup } from '@/api/types'
import { copyText } from '@/lib/clipboard'
import { groupSecret, isCompleteCode } from '@/lib/code'
import { cx } from '@/lib/cx'

export const inputCls =
  'h-10 w-full rounded-lg bg-paper px-3 text-lg text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none transition-shadow duration-100 placeholder:text-ink-3 focus:shadow-[inset_0_0_0_2px_var(--accent)]'

/**
 * 2 段階認証の 6 桁の欄(ログインとアカウントの画面で共用。05 §15)。
 * 欄は 1 つ(貼り付けとパスワード管理の自動入力が素直に効く)。そろったら押さなくても送る。
 * 変換中は送らず、値は送るときにだけ整える(打っている最中の値を書き換えない。runbook §4)
 */
export function CodeInput({
  id = 'code',
  value,
  onChange,
  onComplete,
  disabled = false,
  autoFocus = true,
  inputRef,
  className,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  onComplete: (v: string) => void
  disabled?: boolean
  autoFocus?: boolean
  inputRef?: Ref<HTMLInputElement>
  className?: string
}) {
  return (
    <input
      ref={inputRef}
      id={id}
      name="code"
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      required
      maxLength={12}
      spellCheck={false}
      disabled={disabled}
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value)
        if (!(e.nativeEvent as InputEvent).isComposing && isCompleteCode(e.target.value)) onComplete(e.target.value)
      }}
      onCompositionEnd={(e) => {
        if (isCompleteCode(e.currentTarget.value)) onComplete(e.currentTarget.value)
      }}
      placeholder="123456"
      className={cx(inputCls, 'text-center text-2xl tracking-[0.3em] tabular-nums', className)}
    />
  )
}

/**
 * 認証アプリに登録する QR と秘密の文字列。QR はサーバが作った SVG を <img> で出す
 * (明暗どちらのテーマでも白地に黒。読み取りやすさのため)。スマホ 1 台で設定するときのために、
 * 文字列のコピーと「認証アプリで開く」(otpauth://)も並べる
 */
export function TotpSecretView({ setup }: { setup: TotpSetup }) {
  return (
    <div className="flex items-start gap-4">
      <img
        src={setup.qr_svg}
        alt="認証アプリで読み取る QR コード"
        width={132}
        height={132}
        className="flex-none rounded-lg bg-white p-1.5 shadow-[inset_0_0_0_1px_var(--line)]"
      />
      <div className="min-w-0">
        <p className="text-sm text-ink-2">手で入れるときの文字列</p>
        {/* 4 文字の組の途中では折り返さない(組の間の空白で折り返す) */}
        <p className="mt-1 font-bold tracking-wider tabular-nums" data-totp-secret={setup.secret}>
          {groupSecret(setup.secret)}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <button
            type="button"
            onClick={() => void copyText(setup.secret, '文字列をコピーしました')}
            className="inline-flex items-center gap-1 text-sm text-accent-ink hover:underline"
          >
            <Copy size={13} aria-hidden />
            コピー
          </button>
          <a href={setup.otpauth_uri} className="inline-flex items-center gap-1 text-sm text-accent-ink hover:underline">
            <Smartphone size={13} aria-hidden />
            認証アプリで開く
          </a>
        </div>
      </div>
    </div>
  )
}
