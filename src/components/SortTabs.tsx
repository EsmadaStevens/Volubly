import type { SortOrder } from '../types'

const OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'ending_soon', label: 'Ending soon' },
  { value: 'busiest', label: 'Busiest' },
]

export default function SortTabs({ value, onChange }: { value: SortOrder; onChange: (v: SortOrder) => void }) {
  return (
    <div role="group" aria-label="Sort rooms" className="flex flex-wrap gap-2">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-[44px] rounded-full px-4 text-sm font-semibold ${
            value === o.value ? 'bg-accent text-night' : 'bg-raised text-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
