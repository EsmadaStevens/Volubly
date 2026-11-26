import { INVITE_WINDOW_MS, THREAD_MS, type WhisperView } from './whisperTypes'

export type WhisperPhase = 'invite_open' | 'invite_expired' | 'open' | 'time_up' | 'declined' | 'ended'

type Timed = Pick<WhisperView, 'status' | 'createdAtMs' | 'acceptedAtMs'>

/**
 * Where a whisper is in its life, from its stored times and the clock.
 * Same comparisons as firestore.rules: open while now < end, over once now >= end.
 */
export function whisperPhase(w: Timed, nowMs: number): WhisperPhase {
  switch (w.status) {
    case 'requested':
      return nowMs < w.createdAtMs + INVITE_WINDOW_MS ? 'invite_open' : 'invite_expired'
    case 'accepted':
      return w.acceptedAtMs !== null && nowMs < w.acceptedAtMs + THREAD_MS ? 'open' : 'time_up'
    case 'declined':
      return 'declined'
    case 'ended':
      return 'ended'
  }
}

/** Milliseconds left to accept a pending invite. 0 when it is not a pending invite. */
export function inviteMsLeft(w: Timed, nowMs: number): number {
  if (w.status !== 'requested') return 0
  return Math.max(0, w.createdAtMs + INVITE_WINDOW_MS - nowMs)
}

/** Milliseconds left in an open thread. 0 when it is not open. */
export function threadMsLeft(w: Timed, nowMs: number): number {
  if (w.status !== 'accepted' || w.acceptedAtMs === null) return 0
  return Math.max(0, w.acceptedAtMs + THREAD_MS - nowMs)
}

/** "mm:ss". Rounds up, so it shows 00:01 until the last moment. Never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000)
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

/** "14 min left", or "Under a minute left". */
export function formatInviteLeft(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0
  if (safe < 60_000) return 'Under a minute left'
  return `${Math.floor(safe / 60_000)} min left`
}
