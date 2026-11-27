import { useBusyAction } from '../hooks/useBusyAction'
import type { ActionResult } from '../lib/whisperApi'
import { BTN_CANCEL_INVITE, BUSY, waitingFor } from '../lib/whisperCopy'
import { formatInviteLeft, inviteMsLeft } from '../lib/whisperTime'
import type { WhisperView } from '../lib/whisperTypes'
import type { PublicProfile } from '../types'
import Avatar from './Avatar'

export interface WaitingCardViewProps {
  whisper: WhisperView
  otherId: string
  profile: PublicProfile | null | undefined
  nowMs: number
  busy: string | null
  error: string | null
  finished: boolean
  onCancel: () => void
}

/** What the inviter sees while the invite waits: who, how long is left, and a way to cancel. */
export function WaitingCardView(p: WaitingCardViewProps) {
  const name = p.profile === undefined ? '...' : (p.profile?.username ?? 'Unknown')
  const off = p.busy !== null || p.finished
  return (
    <div className="space-y-3 rounded-2xl bg-surface p-3">
      <div className="flex items-center gap-3">
        <Avatar seed={p.profile?.avatarSeed ?? p.otherId} size={40} />
        <div className="min-w-0">
          <p className="break-words text-base font-bold text-ink">{waitingFor(name)}</p>
          <p className="text-xs text-muted">{formatInviteLeft(inviteMsLeft(p.whisper, p.nowMs))}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={p.onCancel}
        disabled={off}
        aria-busy={p.busy === 'cancel'}
        className="min-h-[44px] rounded-xl bg-raised px-4 text-sm font-semibold text-ink disabled:opacity-50"
      >
        {p.busy === 'cancel' ? BUSY : BTN_CANCEL_INVITE}
      </button>
      {p.error && (
        <p role="alert" className="text-sm text-danger">
          {p.error}
        </p>
      )}
    </div>
  )
}

export default function WaitingCard({
  whisper,
  otherId,
  profile,
  nowMs,
  onCancel,
}: {
  whisper: WhisperView
  otherId: string
  profile: PublicProfile | null | undefined
  nowMs: number
  onCancel: () => Promise<ActionResult>
}) {
  const a = useBusyAction()
  return (
    <WaitingCardView
      whisper={whisper}
      otherId={otherId}
      profile={profile}
      nowMs={nowMs}
      busy={a.busy}
      error={a.error}
      finished={a.finished}
      onCancel={() => void a.run('cancel', onCancel)}
    />
  )
}
