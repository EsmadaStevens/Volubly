import { useBusyAction } from '../hooks/useBusyAction'
import type { ActionResult } from '../lib/whisperApi'
import { BTN_ACCEPT, BTN_DECLINE, BTN_DECLINE_BLOCK, BUSY, invitedBy } from '../lib/whisperCopy'
import { formatInviteLeft, inviteMsLeft } from '../lib/whisperTime'
import type { WhisperView } from '../lib/whisperTypes'
import type { PublicProfile } from '../types'
import Avatar from './Avatar'

const primary =
  'min-h-[44px] rounded-xl bg-accent px-5 text-base font-bold text-night disabled:opacity-50'
const secondary = 'min-h-[44px] rounded-xl bg-raised px-4 text-sm font-semibold text-ink disabled:opacity-50'
const danger = 'min-h-[44px] rounded-xl bg-raised px-4 text-sm font-semibold text-danger disabled:opacity-50'

export interface InviteCardViewProps {
  whisper: WhisperView
  /** undefined while loading, null when the person has no profile. */
  profile: PublicProfile | null | undefined
  nowMs: number
  /** Label of the action in flight, or null. */
  busy: string | null
  error: string | null
  /** True once an action has succeeded: the buttons stay off until the card goes away. */
  finished: boolean
  onAccept: () => void
  onDecline: () => void
  onDeclineBlock: () => void
}

/** One pending invite for the person: who, how long is left, and the three things they can do. */
export function InviteCardView(p: InviteCardViewProps) {
  const name = p.profile === undefined ? '...' : (p.profile?.username ?? 'Unknown')
  const off = p.busy !== null || p.finished
  return (
    <div className="space-y-3 rounded-2xl bg-surface p-3">
      <div className="flex items-center gap-3">
        <Avatar seed={p.profile?.avatarSeed ?? p.whisper.inviterId} size={40} />
        <div className="min-w-0">
          <p className="break-words text-base font-bold text-ink">{invitedBy(name)}</p>
          <p className="text-xs text-muted">{formatInviteLeft(inviteMsLeft(p.whisper, p.nowMs))}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={p.onAccept} disabled={off} aria-busy={p.busy === 'accept'} className={primary}>
          {p.busy === 'accept' ? BUSY : BTN_ACCEPT}
        </button>
        <button type="button" onClick={p.onDecline} disabled={off} aria-busy={p.busy === 'decline'} className={secondary}>
          {p.busy === 'decline' ? BUSY : BTN_DECLINE}
        </button>
        <button type="button" onClick={p.onDeclineBlock} disabled={off} aria-busy={p.busy === 'block'} className={danger}>
          {p.busy === 'block' ? BUSY : BTN_DECLINE_BLOCK}
        </button>
      </div>
      {p.error && (
        <p role="alert" className="text-sm text-danger">
          {p.error}
        </p>
      )}
    </div>
  )
}

/** The same card with its own busy and error state. The actions come from the screen that shows it. */
export default function InviteCard({
  whisper,
  profile,
  nowMs,
  onAccept,
  onDecline,
  onDeclineBlock,
  onAccepted,
}: {
  whisper: WhisperView
  profile: PublicProfile | null | undefined
  nowMs: number
  onAccept: () => Promise<ActionResult>
  onDecline: () => Promise<ActionResult>
  onDeclineBlock: () => Promise<ActionResult>
  /** Called after an accept succeeded (the Inbox opens the whisper). */
  onAccepted?: () => void
}) {
  const a = useBusyAction()
  return (
    <InviteCardView
      whisper={whisper}
      profile={profile}
      nowMs={nowMs}
      busy={a.busy}
      error={a.error}
      finished={a.finished}
      onAccept={() =>
        void a.run('accept', onAccept).then((r) => {
          if (r?.ok) onAccepted?.()
        })
      }
      onDecline={() => void a.run('decline', onDecline)}
      onDeclineBlock={() => void a.run('block', onDeclineBlock)}
    />
  )
}
