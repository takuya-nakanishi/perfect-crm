/** 四つ葉の印。4 枚の葉(円)を重ねた形で、ロゴとログイン画面に使う */
export function CloverMark({ size = 20, animated = false }: { size?: number; animated?: boolean }) {
  const leaves = [
    { cx: 8, cy: 8, fill: 'var(--accent)' },
    { cx: 16, cy: 8, fill: 'color-mix(in oklab, var(--accent) 78%, var(--paper))' },
    { cx: 16, cy: 16, fill: 'var(--accent)' },
    { cx: 8, cy: 16, fill: 'color-mix(in oklab, var(--accent) 78%, var(--paper))' },
  ]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="flex-none" aria-hidden>
      {leaves.map((leaf, i) => (
        <circle
          key={i}
          cx={leaf.cx}
          cy={leaf.cy}
          r={5.6}
          fill={leaf.fill}
          className={animated ? 'animate-leaf-in' : undefined}
          style={animated ? { animationDelay: `${120 + i * 90}ms`, transformOrigin: '12px 12px' } : undefined}
        />
      ))}
    </svg>
  )
}
