import type { Timestamp } from 'firebase/firestore'

const MINUTE_MS = 60_000

/** A pending invite can be accepted for this long after it is created. Mirrors isPending() in firestore.rules. */
export const INVITE_WINDOW_MS = 15 * MINUTE_MS
/** An accepted thread is open for this long after acceptedAt. Mirrors isOpenThread() in firestore.rules. */
export const THREAD_MS = 60 * MINUTE_MS
/** Clock safety margin used only where a wrong guess would cause a denied write (slot reuse). */
export const SLOT_MARGIN_MS = 60_000
/**
 * expiresAt on a new whisper is a cleanup hint. The rules accept 75 to 120 minutes after the server time,
 * so the middle of that window tolerates a device clock that is off by about 20 minutes.
 */
export const EXPIRES_HINT_MS = 97.5 * MINUTE_MS
/** At most this many open whispers per person (whisperSlots/{uid}_1..3). */
export const MAX_WHISPERS = 3

export type SlotNumber = 1 | 2 | 3
export const SLOT_NUMBERS: readonly SlotNumber[] = [1, 2, 3]

export const WHISPER_STATUSES = ['requested', 'accepted', 'declined', 'ended'] as const
export type WhisperStatus = (typeof WHISPER_STATUSES)[number]

/** What the screens work with: a whisper document flattened to plain values. */
export interface WhisperView {
  id: string
  inviterId: string
  inviteeId: string
  status: WhisperStatus
  createdAtMs: number
  acceptedAtMs: number | null
  endedBy: string | null
  inviterSlot: SlotNumber
  inviteeSlot: SlotNumber | null
  /** Kept as received: slot and message documents must copy it exactly. */
  expiresAt: Timestamp
}
