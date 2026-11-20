const btn = 'min-h-[44px] rounded-xl bg-raised px-3 text-sm font-bold text-ink'

export default function DemoTools({
  onChatter,
  onFlagged,
  onSpoilers,
  onClear,
  count,
}: {
  onChatter: (n: number, scrollUpFirst: boolean) => void
  onFlagged: () => void
  onSpoilers: () => void
  onClear: () => void
  count: number
}) {
  return (
    <details className="px-3 pb-2" open>
      <summary className="min-h-[44px] cursor-pointer py-2 text-xs font-bold text-warn">
        DEMO MODE: messages marked SIMULATED exist only on this screen ({count} now)
      </summary>
      <div className="space-y-2 rounded-xl border border-warn/40 bg-surface p-3">
        <p className="text-xs text-muted">
          These are made up to show the app under load. They are not stored, and nobody else can see them. Real
          messages you send still go through the normal checks.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => onChatter(10, false)}>
            Add 10 simulated
          </button>
          <button type="button" className={btn} onClick={() => onChatter(60, true)}>
            Add 60 while I'm away
          </button>
          <button type="button" className={btn} onClick={onFlagged}>
            Add flagged examples
          </button>
          <button type="button" className={btn} onClick={onSpoilers}>
            Add spoiler examples
          </button>
          <button type="button" className={`${btn} text-muted`} onClick={onClear} disabled={count === 0}>
            Clear simulated
          </button>
        </div>
      </div>
    </details>
  )
}
