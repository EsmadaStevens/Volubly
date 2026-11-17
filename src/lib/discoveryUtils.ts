import { MATURITY_LABELS, type AgeBandLabel, type Category, type MaturityLabel, type RoomView, type SortOrder } from '../types'
import { ROOM_LIFETIME_MS } from '../types'
import { isExpired } from './roomUtils'

/** Mirrors ageCanReadRoom() in firestore.rules exactly. */
export function canSeeMaturity(band: AgeBandLabel, label: MaturityLabel): boolean {
  if (band === '18_plus') return true
  if (band === '13_17') return label === 'all_ages' || label === '13_plus'
  return label === 'all_ages'
}

export function allowedMaturities(band: AgeBandLabel): MaturityLabel[] {
  return MATURITY_LABELS.filter((l) => canSeeMaturity(band, l))
}

/** null means no constraint is needed (the user can see every label). */
export function maturityConstraint(band: AgeBandLabel): MaturityLabel[] | null {
  const allowed = allowedMaturities(band)
  return allowed.length === MATURITY_LABELS.length ? null : allowed
}

export interface DiscoveryPlan {
  maturityIn: MaturityLabel[] | null
  openedAfterMs: number
  direction: 'asc' | 'desc'
  limit: number
}

/**
 * What to ask Firestore for. Firestore rules are not filters: the query itself must carry
 * the maturity constraint, or the rules reject it. "busiest" is sorted on the client, so it
 * shares the newest query.
 */
export function discoveryPlan(band: AgeBandLabel, order: SortOrder, nowMs: number): DiscoveryPlan {
  return {
    maturityIn: maturityConstraint(band),
    openedAfterMs: nowMs - ROOM_LIFETIME_MS,
    direction: order === 'ending_soon' ? 'asc' : 'desc',
    limit: 100,
  }
}

export function matchedPick(room: RoomView, picks: Category[]): Category | null {
  return room.categories.find((c) => picks.includes(c)) ?? null
}

export function sortRooms(rooms: RoomView[], order: SortOrder): RoomView[] {
  const out = [...rooms]
  out.sort((a, b) => {
    let d = 0
    if (order === 'newest') d = b.openedAtMs - a.openedAtMs
    else if (order === 'ending_soon') d = a.openedAtMs - b.openedAtMs
    else d = b.postingParticipantCount - a.postingParticipantCount || b.openedAtMs - a.openedAtMs
    return d || a.id.localeCompare(b.id)
  })
  return out
}

/** Drops closed rooms, sorts, then splits into "Your picks" and "Also live". */
export function splitAndSort(rooms: RoomView[], picks: Category[], order: SortOrder, nowMs: number) {
  const open = rooms.filter((r) => !isExpired(r.openedAtMs, nowMs))
  const sorted = sortRooms(open, order)
  if (picks.length === 0) return { picks: [] as RoomView[], other: sorted }
  return {
    picks: sorted.filter((r) => matchedPick(r, picks) !== null),
    other: sorted.filter((r) => matchedPick(r, picks) === null),
  }
}
