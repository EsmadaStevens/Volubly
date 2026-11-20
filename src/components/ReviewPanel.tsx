import { FINDING_LABEL, type FindingKind } from '../lib/redact'
import { VERDICT_MESSAGE, type Verdict } from '../lib/draftCheck'

export interface ReviewState {
  redactedText: string | null
  findingKinds: string[]
  verdict: Exclude<Verdict, 'ok'> | null
}

export default function ReviewPanel({
  review,
  onRedactSend,
  onSendAnyway,
  onEdit,
}: {
  review: ReviewState
  onRedactSend: () => void
  onSendAnyway: () => void
  onEdit: () => void
}) {
  const btn = 'min-h-[44px] rounded-xl px-4 text-sm font-bold'
  return (
    <section aria-label="Check before sending" className="space-y-2 rounded-xl border border-warn/60 bg-surface p-3">
      <p className="text-sm font-bold text-warn">Before this goes out</p>
      <ul className="space-y-1 text-sm text-ink">
        {review.findingKinds.length > 0 && (
          <li>
            This looks like it contains{' '}
            {review.findingKinds.map((k) => FINDING_LABEL[k as FindingKind] ?? k).join(', ')}. Everyone in the room
            would see it.
          </li>
        )}
        {review.verdict && <li>{VERDICT_MESSAGE[review.verdict]}</li>}
      </ul>
      {review.redactedText !== null && (
        <p className="break-words rounded-lg bg-night px-3 py-2 text-sm text-muted">
          <span className="text-xs font-bold">Would send: </span>
          {review.redactedText}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {review.redactedText !== null && (
          <button type="button" onClick={onRedactSend} className={`${btn} bg-accent text-night`}>
            Redact &amp; send
          </button>
        )}
        <button type="button" onClick={onEdit} className={`${btn} bg-raised text-ink`}>
          Edit
        </button>
        <button type="button" onClick={onSendAnyway} className={`${btn} text-muted underline`}>
          Send anyway
        </button>
      </div>
    </section>
  )
}
