import type { WhisperView } from '../whisperTypes'

/** Shared helpers for whisper tests. Not a test file. */
export const MIN = 60_000
export const NOW = 1_800_000_000_000

let seq = 0

/** A whisper view. Defaults: a pending invite from 'them' to 'me', created 5 minutes before NOW. */
export function whisperView(over: Partial<WhisperView> = {}, now = NOW): WhisperView {
  seq += 1
  return {
    id: `w${seq}`,
    inviterId: 'them',
    inviteeId: 'me',
    status: 'requested',
    createdAtMs: now - 5 * MIN,
    acceptedAtMs: null,
    endedBy: null,
    inviterSlot: 1,
    inviteeSlot: null,
    expiresAt: { toMillis: () => now } as unknown as WhisperView['expiresAt'],
    ...over,
  }
}

/** An accepted thread that was accepted `ageMin` minutes before `now`. */
export function openWhisper(ageMin: number, over: Partial<WhisperView> = {}, now = NOW): WhisperView {
  return whisperView(
    { status: 'accepted', createdAtMs: now - (ageMin + 1) * MIN, acceptedAtMs: now - ageMin * MIN, inviteeSlot: 1, ...over },
    now,
  )
}
