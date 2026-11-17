export default function LiveDot({ color = '#22e58b' }: { color?: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 shrink-0 rounded-full"
      style={{
        background: `radial-gradient(circle at 35% 30%, #fff 0 12%, ${color} 32%, #06361c 100%)`,
        boxShadow: `0 0 8px ${color}99`,
      }}
    />
  )
}
