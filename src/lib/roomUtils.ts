import { CATEGORY_LABELS, ROOM_LIFETIME_MS, type Category } from '../types'

export const MINUTE_MS = 60_000
export const HOUR_MS = 3_600_000

/** A room closes exactly 24 hours after it opened. This is the only timer rule. */
export function closesAtMs(openedAtMs: number): number {
  return openedAtMs + ROOM_LIFETIME_MS
}

export function isExpired(openedAtMs: number, nowMs: number): boolean {
  return nowMs >= closesAtMs(openedAtMs)
}

export function msLeft(openedAtMs: number, nowMs: number): number {
  return Math.max(0, closesAtMs(openedAtMs) - nowMs)
}

export function formatTimeLeft(ms: number): string {
  if (ms <= 0) return 'Closed'
  if (ms < MINUTE_MS) return 'Under 1m left'
  const totalMinutes = Math.floor(ms / MINUTE_MS)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m left`
  return `${h}h ${String(m).padStart(2, '0')}m left`
}

/** Plain-words reason a room is listed. Never "trending" or "popular". */
export function reasonLabel(args: { matchedPick: Category | null; ageMs: number; leftMs: number }): string {
  if (args.matchedPick) return `In your ${CATEGORY_LABELS[args.matchedPick]} picks`
  if (args.leftMs < HOUR_MS) return 'Ending soon'
  if (args.ageMs < 15 * MINUTE_MS) return 'Just opened'
  return 'Live now'
}
