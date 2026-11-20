import { ROOM_LIFETIME_MS } from '../types'

export const MAX_ACTIVE_ROOMS = 2
/** Clock safety margin: the rules use server time, this device's clock may be a little off. */
const CLOCK_MARGIN_MS = 60_000

export const slotId = (uid: string, n: 1 | 2) => `${uid}_${n}`

export interface SlotInfo {
  n: 1 | 2
  /** null = the slot does not exist (or could not be read) */
  openedAtMs: number | null
}

/** A slot is busy while its room is still open (with a small margin on the safe side). */
export function isSlotBusy(openedAtMs: number | null, nowMs: number): boolean {
  return openedAtMs !== null && nowMs < openedAtMs + ROOM_LIFETIME_MS + CLOCK_MARGIN_MS
}

/**
 * Which slots to try, best first: never-used slots, then the one that freed up longest ago.
 * Empty means both rooms are still live, so the person is at the limit.
 */
export function slotsToTry(slots: SlotInfo[], nowMs: number): Array<1 | 2> {
  return slots
    .filter((s) => !isSlotBusy(s.openedAtMs, nowMs))
    .sort((a, b) => (a.openedAtMs ?? -Infinity) - (b.openedAtMs ?? -Infinity))
    .map((s) => s.n)
}

export class RoomLimitError extends Error {
  constructor() {
    super(`You already have ${MAX_ACTIVE_ROOMS} live rooms.`)
    this.name = 'RoomLimitError'
  }
}
