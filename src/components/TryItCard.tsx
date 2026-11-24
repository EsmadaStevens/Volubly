import { useState } from 'react'

const KEY = 'volubly.tryItDismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === 'yes'
  } catch {
    return false
  }
}

/** The card itself, so it can be drawn and tested without storage. */
export function TryItBody({ onDismiss }: { onDismiss?: () => void }) {
  return (
    <section aria-label="Try Ghost-Mode" className="space-y-2 rounded-2xl border border-spark/40 bg-raised p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-bold text-ink">Try Ghost-Mode in 30 seconds</h2>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="min-h-[44px] shrink-0 text-xs font-bold text-spark underline">
            Got it
          </button>
        )}
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
        <li>Open a room, or start your own with New room.</li>
        <li>
          Type <span className="font-bold text-accent">shut up, nobody asked</span> and press Send. On desktop Chrome with
          built-in AI, the check runs on your device and you get a review before anything is sent.
        </li>
        <li>
          Open <span className="font-bold">Ghost-Mode</span> to see where each check ran and why. Phones have no on-device
          model, so tick the cloud check there to try the cloud route.
        </li>
      </ol>
      <p className="text-xs text-muted">
        Ghost-Mode flags and you decide. Phone numbers, emails, passwords and keys are hidden by plain code first, on every
        device.
      </p>
    </section>
  )
}

export default function TryItCard() {
  const [dismissed, setDismissed] = useState(readDismissed)
  if (dismissed) return null
  return (
    <TryItBody
      onDismiss={() => {
        setDismissed(true)
        try {
          localStorage.setItem(KEY, 'yes')
        } catch {
          /* private window: it will just show again next time */
        }
      }}
    />
  )
}
