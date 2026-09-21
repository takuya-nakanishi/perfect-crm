import { createElement, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { TagColor } from '@/api/types'
import { cx } from '@/lib/cx'
import { objectIcon } from '@/lib/icons'

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd font-sans">{children}</kbd>
}

/** 選択肢の値を示す色付きのラベル */
export function Tag({ color, children, className }: { color: TagColor; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx('inline-flex h-[22px] max-w-full items-center rounded-[5px] px-1.5 text-sm whitespace-nowrap', className)}
      style={{ background: `var(--tag-${color}-bg)`, color: `var(--tag-${color}-ink)` }}
    >
      <span className="truncate">{children}</span>
    </span>
  )
}

export function Avatar({ name, color, size = 20 }: { name: string; color: TagColor; size?: number }) {
  return (
    <span
      className="inline-grid flex-none place-items-center rounded-full font-bold select-none"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
        background: `var(--tag-${color}-bg)`,
        color: `var(--tag-${color}-ink)`,
      }}
      aria-hidden
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'danger'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-strong font-bold',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
  outline: 'text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-sunken',
  danger: 'text-danger hover:bg-danger-wash',
}

export function Button({
  variant = 'ghost',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex flex-none items-center justify-center gap-1.5 rounded-md whitespace-nowrap transition-colors duration-100 disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2 text-sm' : 'h-8 px-3 text-base',
        BUTTON_STYLES[variant],
        className,
      )}
    />
  )
}

/** アイコンだけのボタン。label は読み上げとツールチップに使う */
export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cx(
        'inline-grid size-7 flex-none place-items-center rounded-md text-ink-2 transition-colors duration-100 hover:bg-sunken hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** テーブルのアイコン。色はタグと同じ色の組を使う */
export function ObjectIcon({ icon, color, size = 16 }: { icon: string; color: TagColor; size?: number }) {
  return (
    <span
      className="inline-grid flex-none place-items-center rounded-[5px]"
      style={{
        width: size + 6,
        height: size + 6,
        background: `var(--tag-${color}-bg)`,
        color: `var(--tag-${color}-ink)`,
      }}
    >
      {createElement(objectIcon(icon), { size: size - 2, strokeWidth: 2, 'aria-hidden': true })}
    </span>
  )
}
