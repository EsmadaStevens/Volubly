import {
  INVITE_WINDOW_MS,
  SLOT_MARGIN_MS,
  SLOT_NUMBERS,
  THREAD_MS,
  type SlotNumber,
  type WhisperView,
} from './whisperTypes'

/** One of the person's slot documents (whisperSlots/{uid}_{n}), reduced to what the pick needs. */
export interface SlotDoc {
  n: SlotNumber
  whisperId: string
}

/**
 * True when the whisper is clearly over, with a safety margin on the two timed cases.
 * The rules call a slot reusable once the whisper is over by server time. This device's clock may be
 * a little off, so for timed cases the client waits 60 seconds longer. That costs a short wait,
 * never a denied write. Declined and ended are final and need no margin.
 */
function isOverWithMargin(w: WhisperView, nowMs: number): boolean {
  switch (w.status) {
    case 'declined':
    case 'ended':
      return true
    case 'requested':
      return nowMs >= w.createdAtMs + INVITE_WINDOW_MS + SLOT_MARGIN_MS
    case 'accepted':
      // An accepted whisper with no acceptedAt should not exist. Treat it as busy: the safe side.
      return w.acceptedAtMs !== null && nowMs >= w.acceptedAtMs + THREAD_MS + SLOT_MARGIN_MS
  }
}

/**
 * Which slot to use for a new invite or an accept, or null when all three are busy.
 *
 * - No slot document: never used, best.
 * - The slot names a whisper that is not in the loaded list: treated as cleaned up, free.
 * - The slot names a whisper that is over: free, and the one that has been free longest comes first.
 * - Otherwise busy.
 * Ties go to the lower number.
 */
export function pickSlot(slots: SlotDoc[], whispers: WhisperView[], nowMs: number): SlotNumber | null {
  const byId = new Map(whispers.map((w) => [w.id, w]))
  let best: { n: SlotNumber; rank: number } | null = null
  for (const n of SLOT_NUMBERS) {
    const slot = slots.find((s) => s.n === n)
    let rank: number
    if (!slot) {
      rank = -Infinity
    } else {
      const w = byId.get(slot.whisperId)
      if (!w) rank = 0
      else if (isOverWithMargin(w, nowMs)) rank = w.createdAtMs
      else continue
    }
    if (best === null || rank < best.rank) best = { n, rank }
  }
  return best ? best.n : null
}
