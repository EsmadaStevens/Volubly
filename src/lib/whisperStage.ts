import { whisperPhase } from './whisperTime'
import type { WhisperView } from './whisperTypes'
import type { SubState } from './whisperWatch'

/** What the whisper screen shows. */
export type Stage =
  | 'loading'
  | 'error'
  /** Missing, refused, or not this person's whisper. */
  | 'unavailable'
  /** A pending invite, seen by the person who was invited. */
  | 'invite_invitee'
  /** A pending invite, seen by the person who sent it. */
  | 'invite_inviter'
  | 'invite_expired'
  /** Time is up, declined, ended, or a send showed the hour has just ended. No cause is shown. */
  | 'ended'
  | 'open'

/**
 * Decides which view the whisper page shows. `forcedEnd` is set when a refused send showed that the
 * hour has just ended, before the clock or the document says so.
 */
export function whisperStage(i: { sub: SubState<WhisperView>; uid: string; nowMs: number; forcedEnd: boolean }): Stage {
  const { sub } = i
  if (sub.status === 'idle' || sub.status === 'loading') return 'loading'
  if (sub.status === 'error') return 'error'
  if (sub.status === 'denied') return 'unavailable'
  const w = sub.data
  if (w.inviterId !== i.uid && w.inviteeId !== i.uid) return 'unavailable'
  switch (whisperPhase(w, i.nowMs)) {
    case 'invite_open':
      return w.inviteeId === i.uid ? 'invite_invitee' : 'invite_inviter'
    case 'invite_expired':
      return 'invite_expired'
    case 'open':
      return i.forcedEnd ? 'ended' : 'open'
    case 'time_up':
    case 'declined':
    case 'ended':
      return 'ended'
  }
}
