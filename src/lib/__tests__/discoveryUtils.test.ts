import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  allowedMaturities,
  canSeeMaturity,
  discoveryPlan,
  matchedPick,
  maturityConstraint,
  sortRooms,
  splitAndSort,
} from '../discoveryUtils'
import { isExpired, HOUR_MS } from '../roomUtils'
import {
  AGE_BANDS,
  CATEGORY_ALLOWLIST,
  MATURITY_LABELS,
  ROOM_LIFETIME_MS,
  type Category,
  type RoomView,
} from '../../types'

const NOW = 2_000_000_000_000

const roomArb = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom('live_room' as const, 'open_topic' as const),
  title: fc.string({ minLength: 3, maxLength: 60 }),
  maturityLabel: fc.constantFrom(...MATURITY_LABELS),
  categories: fc.uniqueArray(fc.constantFrom(...CATEGORY_ALLOWLIST), { minLength: 1, maxLength: 3 }),
  openedAtMs: fc.integer({ min: NOW - 30 * HOUR_MS, max: NOW }),
  postingParticipantCount: fc.integer({ min: 0, max: 500 }),
  createdBy: fc.string({ minLength: 1, maxLength: 10 }),
}) as fc.Arbitrary<RoomView>

describe('maturity (must match firestore.rules)', () => {
  it('follows the same matrix as the rules', () => {
    expect(allowedMaturities('under_13')).toEqual(['all_ages'])
    expect(allowedMaturities('13_17')).toEqual(['all_ages', '13_plus'])
    expect(allowedMaturities('18_plus')).toEqual(['all_ages', '13_plus', '18_plus'])
  })

  it('asks for a constraint exactly when the user cannot see everything', () => {
    for (const band of AGE_BANDS) {
      const c = maturityConstraint(band)
      if (band === '18_plus') expect(c).toBeNull()
      else {
        expect(c).not.toBeNull()
        for (const l of MATURITY_LABELS) expect(c!.includes(l)).toBe(canSeeMaturity(band, l))
      }
    }
  })
})

describe('discoveryPlan', () => {
  it('only asks for rooms opened in the last 24 hours', () => {
    const p = discoveryPlan('18_plus', 'newest', NOW)
    expect(NOW - p.openedAfterMs).toBe(ROOM_LIFETIME_MS)
    expect(p.limit).toBe(100)
  })
  it('puts busiest on the newest query and sorts it on the client', () => {
    expect(discoveryPlan('18_plus', 'busiest', NOW).direction).toBe('desc')
    expect(discoveryPlan('18_plus', 'newest', NOW).direction).toBe('desc')
    expect(discoveryPlan('18_plus', 'ending_soon', NOW).direction).toBe('asc')
  })
  it('carries the maturity constraint for teens', () => {
    expect(discoveryPlan('13_17', 'newest', NOW).maturityIn).toEqual(['all_ages', '13_plus'])
  })
})

describe('splitAndSort properties', () => {
  const orders = ['newest', 'ending_soon', 'busiest'] as const
  const picksArb = fc.uniqueArray(fc.constantFrom(...CATEGORY_ALLOWLIST), { maxLength: 4 })

  it('never lists a closed room', () => {
    fc.assert(
      fc.property(fc.array(roomArb, { maxLength: 30 }), picksArb, fc.constantFrom(...orders), (rooms, picks, order) => {
        const out = splitAndSort(rooms, picks, order, NOW)
        for (const r of [...out.picks, ...out.other]) expect(isExpired(r.openedAtMs, NOW)).toBe(false)
      }),
    )
  })

  it('keeps every open room exactly once', () => {
    fc.assert(
      fc.property(fc.uniqueArray(roomArb, { selector: (r) => r.id, maxLength: 30 }), picksArb, fc.constantFrom(...orders), (rooms, picks, order) => {
        const out = splitAndSort(rooms, picks, order, NOW)
        const ids = [...out.picks, ...out.other].map((r) => r.id).sort()
        const open = rooms.filter((r) => !isExpired(r.openedAtMs, NOW)).map((r) => r.id).sort()
        expect(ids).toEqual(open)
      }),
    )
  })

  it('puts a room in "Your picks" only when it matches a pick', () => {
    fc.assert(
      fc.property(fc.array(roomArb, { maxLength: 30 }), picksArb, (rooms, picks) => {
        const out = splitAndSort(rooms, picks, 'newest', NOW)
        for (const r of out.picks) expect(matchedPick(r, picks as Category[])).not.toBeNull()
        for (const r of out.other) expect(matchedPick(r, picks as Category[])).toBeNull()
      }),
    )
  })

  it('shows one plain list when no categories are chosen', () => {
    const out = splitAndSort([{ ...rooms()[0] }], [], 'newest', NOW)
    expect(out.picks).toEqual([])
    expect(out.other).toHaveLength(1)
  })
})

describe('sortRooms', () => {
  it('orders newest first, ending soonest first, busiest first', () => {
    fc.assert(
      fc.property(fc.array(roomArb, { minLength: 2, maxLength: 20 }), (rs) => {
        const n = sortRooms(rs, 'newest')
        const e = sortRooms(rs, 'ending_soon')
        const b = sortRooms(rs, 'busiest')
        for (let i = 1; i < rs.length; i++) {
          expect(n[i - 1].openedAtMs).toBeGreaterThanOrEqual(n[i].openedAtMs)
          expect(e[i - 1].openedAtMs).toBeLessThanOrEqual(e[i].openedAtMs)
          expect(b[i - 1].postingParticipantCount).toBeGreaterThanOrEqual(b[i].postingParticipantCount)
        }
      }),
    )
  })
})

function rooms(): RoomView[] {
  return [
    {
      id: 'a',
      type: 'live_room',
      title: 'Test room',
      maturityLabel: 'all_ages',
      categories: ['music'],
      openedAtMs: NOW - HOUR_MS,
      postingParticipantCount: 3,
      createdBy: 'u',
    },
  ]
}
