import type { Timestamp } from 'firebase/firestore'
import { WHISPER_STATUSES, type SlotNumber, type WhisperStatus, type WhisperView } from './whisperTypes'

type TimeLike = { toMillis: () => number }

function isTime(v: unknown): v is TimeLike {
  return typeof v === 'object' && v !== null && typeof (v as TimeLike).toMillis === 'function'
}

function millis(v: TimeLike): number | null {
  const n = v.toMillis()
  return Number.isFinite(n) ? n : null
}

function asSlot(v: unknown): SlotNumber | null {
  return v === 1 || v === 2 || v === 3 ? v : null
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/**
 * A whisper document as the screens use it. Returns null when a field is missing or the wrong type,
 * so a malformed document is skipped instead of breaking a screen. Read documents with
 * data({ serverTimestamps: 'estimate' }) so a write that has not reached the server still has times.
 */
export function toWhisperView(id: string, data: Record<string, unknown> | null | undefined): WhisperView | null {
  if (!data || typeof data !== 'object') return null
  if (!nonEmptyString(id)) return null
  if (!nonEmptyString(data.inviterId) || !nonEmptyString(data.inviteeId)) return null
  if (!WHISPER_STATUSES.includes(data.status as WhisperStatus)) return null

  if (!isTime(data.createdAt)) return null
  const createdAtMs = millis(data.createdAt)
  if (createdAtMs === null) return null

  let acceptedAtMs: number | null = null
  if (data.acceptedAt !== null && data.acceptedAt !== undefined) {
    if (!isTime(data.acceptedAt)) return null
    acceptedAtMs = millis(data.acceptedAt)
    if (acceptedAtMs === null) return null
  }

  let endedBy: string | null = null
  if (data.endedBy !== null && data.endedBy !== undefined) {
    if (!nonEmptyString(data.endedBy)) return null
    endedBy = data.endedBy
  }

  const inviterSlot = asSlot(data.inviterSlot)
  if (inviterSlot === null) return null

  let inviteeSlot: SlotNumber | null = null
  if (data.inviteeSlot !== null && data.inviteeSlot !== undefined) {
    inviteeSlot = asSlot(data.inviteeSlot)
    if (inviteeSlot === null) return null
  }

  if (!isTime(data.expiresAt)) return null

  return {
    id,
    inviterId: data.inviterId,
    inviteeId: data.inviteeId,
    status: data.status as WhisperStatus,
    createdAtMs,
    acceptedAtMs,
    endedBy,
    inviterSlot,
    inviteeSlot,
    expiresAt: data.expiresAt as unknown as Timestamp,
  }
}
