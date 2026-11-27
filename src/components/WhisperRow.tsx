import { useBusyAction } from '../hooks/useBusyAction'
import type { ActionResult } from '../lib/whisperApi'
import { BTN_CANCEL_INVITE, BUSY, waitingFor } from '../lib/whisperCopy'
import { formatInviteLeft, inviteMsLeft, threadMsLeft } from '../lib/whisperTime'
import type { WhisperView } from '../lib/whisperTypes'
import type { PublicProfile } from '../types'
import Avatar from './Avatar'

export interface WhisperRowViewProps {
  whisper: WhisperView
  /** `open`: a thread in progress. `waiting`: an invite this person sent. */
  variant: 'open' | 'waiting'
  /** The other person. */
  otherId: string
  profile: PublicProfile | null | undefined
  nowMs: number
  busy: string | null
  error: string | null
  finished: boolean
  onCancel: () => void
}

/** One row in the Inbox: an open whisper, or an invite that is still waiting for a reply. */
export function WhisperRowView(p: WhisperRowViewProps) {
  const name = p.profile === undefined ? '...' : (p.profile?.username ?? 'Unknown')
  const left = formatInviteLeft(p.variant === 'open' ? threadMsLeft(p.whisper, p.nowMs) : inviteMsLeft(p.whisper, p.nowMs))
  const off = p.busy !== null || p.finished
  return (
    <div className="space-y-2 rounded-2xl bg-surface p-3">
      <a href={`#whisper/${p.whisper.id}`} className="flex min-h-[44px] items-center gap-3">
        <Avatar seed={p.profile?.avatarSeed ?? p.otherId} size={40} />
        <span className="min-w-0">
          <span className="block break-words text-base font-bold text-ink">
            {p.variant === 'waiting' ? waitingFor(name) : name}
          </span>
          <span className="block text-xs text-muted">{left}</span>
        </span>
      </a>
      {p.variant === 'waiting' && (
        <button
          type="button"
          onClick={p.onCancel}
          disabled={off}
          aria-busy={p.busy === 'cancel'}
          className="min-h-[44px] rounded-xl bg-raised px-4 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {p.busy === 'cancel' ? BUSY : BTN_CANCEL_INVITE}
        </button>
      )}
      {p.error && (
        <p role="alert" className="text-sm text-danger">
          {p.error}
        </p>
      )}
    </div>
  )
}

/** The same row with its own busy and error state (used by waiting rows, which can be cancelled). */
export default function WhisperRow({
  whisper,
  variant,
  otherId,
  profile,
  nowMs,
  onCancel,
}: {
  whisper: WhisperView
  variant: 'open' | 'waiting'
  otherId: string
  profile: PublicProfile | null | undefined
  nowMs: number
  onCancel: () => Promise<ActionResult>
}) {
  const a = useBusyAction()
  return (
    <WhisperRowView
      whisper={whisper}
      variant={variant}
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
