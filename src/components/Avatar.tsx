import { avatarCells, avatarHue } from '../lib/avatar'

export default function Avatar({ seed, size = 40 }: { seed: string; size?: number }) {
  const hue = avatarHue(seed)
  const cells = avatarCells(seed)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 5 5"
      role="img"
      aria-label="Avatar"
      className="shrink-0 rounded-full"
      style={{ background: `hsl(${hue} 35% 20%)` }}
    >
      {cells.map((row, r) =>
        row.map((on, c) =>
          on ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill={`hsl(${hue} 70% 65%)`} /> : null,
        ),
      )}
    </svg>
  )
}
