import { CATEGORY_ALLOWLIST, CATEGORY_LABELS, type Category } from '../types'

export default function CategoryChips({
  label,
  selected,
  onToggle,
  max,
}: {
  label: string
  selected: Category[]
  onToggle: (c: Category) => void
  max?: number
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {CATEGORY_ALLOWLIST.map((c) => {
        const on = selected.includes(c)
        const full = !on && max !== undefined && selected.length >= max
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            disabled={full}
            onClick={() => onToggle(c)}
            className={`min-h-[44px] rounded-full px-4 text-sm font-semibold disabled:opacity-40 ${
              on ? 'bg-accent text-night' : 'bg-raised text-muted'
            }`}
          >
            {CATEGORY_LABELS[c]}
          </button>
        )
      })}
    </div>
  )
}
