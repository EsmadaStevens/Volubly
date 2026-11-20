import { DELAY_CHOICES, type DelaySecs } from '../lib/spoiler'

export default function DelayControl({ value, onChange }: { value: DelaySecs; onChange: (d: DelaySecs) => void }) {
  return (
    <div role="group" aria-label="How far behind live is your stream" className="space-y-1">
      <p className="text-xs text-muted">
        Watching a stream? Hold back messages that might spoil it, until your delay has passed.
      </p>
      <div className="flex flex-wrap gap-2">
        {DELAY_CHOICES.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={value === d}
            onClick={() => onChange(d)}
            className={`min-h-[44px] rounded-xl px-4 text-sm font-semibold ${
              value === d ? 'bg-accent text-night' : 'bg-raised text-muted'
            }`}
          >
            {d === 0 ? 'No delay' : `${d} s behind`}
          </button>
        ))}
      </div>
    </div>
  )
}
