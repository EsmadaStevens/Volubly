import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// Feature: whisper-threads, model invariants.
// No emulator is used here. This is a small TypeScript model of the rules, so the generators can
// run many more times than the emulator properties (which stay at 20 or fewer). The model mirrors
// the time windows in firestore.rules: an invite can be accepted for 15 minutes, a thread is open
// for 1 hour from acceptance, and nothing reads a stored expiresAt.
//
// The age band is self-declared; the model uses the stored band, as the rules do.

const MIN = 60_000

type Status = 'requested' | 'accepted' | 'declined' | 'ended'
interface W {
  status: Status
  createdAt: number
  acceptedAt: number | null
}

const isOpen = (w: W, now: number) =>
  w.status === 'accepted' && w.acceptedAt !== null && now < w.acceptedAt + 60 * MIN
const isPending = (w: W, now: number) => w.status === 'requested' && now < w.createdAt + 15 * MIN
const isOver = (w: W, now: number) => !isOpen(w, now) && !isPending(w, now)
const canSend = (w: W, now: number) => isOpen(w, now)

type Band = 'under_13' | '13_17' | '18_plus'
const bandArb = fc.constantFrom<Band>('under_13', '13_17', '18_plus')
const pairable = (a: Band, b: Band) => a === b && a !== 'under_13'

describe('Feature: whisper-threads, model invariants', () => {
  it('property 1: a message is never allowed outside the one-hour window', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Status>('requested', 'accepted', 'declined', 'ended'),
        fc.integer({ min: 0, max: 600 * MIN }), // creation time
        fc.integer({ min: 0, max: 100 * MIN }), // delay between create and accept
        fc.integer({ min: 0, max: 400 * MIN }), // delay between accept and message
        (status, createdAt, acceptDelay, sendDelay) => {
          const acceptedAt = status === 'accepted' || status === 'ended' ? createdAt + acceptDelay : null
          const w: W = { status, createdAt, acceptedAt }
          const now = (acceptedAt ?? createdAt) + sendDelay
          if (canSend(w, now)) {
            expect(status).toBe('accepted')
            expect(now - (acceptedAt as number)).toBeLessThan(60 * MIN)
          }
          if (status === 'accepted' && now - (acceptedAt as number) < 60 * MIN) expect(canSend(w, now)).toBe(true)
        },
      ),
      { numRuns: 1000 },
    )
  })

  it('property 2: different or under_13 bands can never be paired, whatever the order', () => {
    type Event =
      | { kind: 'invite' }
      | { kind: 'accept' }
      | { kind: 'setBands'; a: Band; b: Band }
    const eventArb: fc.Arbitrary<Event> = fc.oneof(
      fc.constant<Event>({ kind: 'invite' }),
      fc.constant<Event>({ kind: 'accept' }),
      fc.record({ kind: fc.constant('setBands' as const), a: bandArb, b: bandArb }),
    )
    fc.assert(
      fc.property(bandArb, bandArb, fc.array(eventArb, { maxLength: 12 }), (a0, b0, events) => {
        let a = a0
        let b = b0
        let state: 'none' | 'requested' | 'accepted' = 'none'
        for (const e of events) {
          if (e.kind === 'setBands') {
            a = e.a
            b = e.b
          } else if (e.kind === 'invite' && state === 'none' && pairable(a, b)) {
            state = 'requested'
          } else if (e.kind === 'accept' && state === 'requested' && pairable(a, b)) {
            state = 'accepted'
            // At the moment of accept the bands matched and were not under_13.
            expect(a).toBe(b)
            expect(a).not.toBe('under_13')
          }
        }
      }),
      { numRuns: 1000 },
    )
  })

  it('property 4: a person never has more than 3 open whispers when slots are reused only when over', () => {
    type Op = { kind: 'advance'; min: number } | { kind: 'invite'; slot: number } | { kind: 'accept'; slot: number } | { kind: 'end'; slot: number }
    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.record({ kind: fc.constant('advance' as const), min: fc.integer({ min: 0, max: 90 }) }),
      fc.record({ kind: fc.constant('invite' as const), slot: fc.integer({ min: 0, max: 2 }) }),
      fc.record({ kind: fc.constant('accept' as const), slot: fc.integer({ min: 0, max: 2 }) }),
      fc.record({ kind: fc.constant('end' as const), slot: fc.integer({ min: 0, max: 2 }) }),
    )
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        let now = 0
        const slots: (W | null)[] = [null, null, null]
        const all: W[] = []
        for (const op of ops) {
          if (op.kind === 'advance') now += op.min * MIN
          else if (op.kind === 'invite') {
            const held = slots[op.slot]
            if (held === null || isOver(held, now)) {
              const w: W = { status: 'requested', createdAt: now, acceptedAt: null }
              slots[op.slot] = w
              all.push(w)
            }
          } else if (op.kind === 'accept') {
            const w = slots[op.slot]
            if (w && isPending(w, now)) {
              w.status = 'accepted'
              w.acceptedAt = now
            }
          } else {
            const w = slots[op.slot]
            if (w && (w.status === 'requested' || w.status === 'accepted')) w.status = 'ended'
          }
          const openCount = all.filter((w) => isOpen(w, now) || isPending(w, now)).length
          expect(openCount).toBeLessThanOrEqual(3)
        }
      }),
      { numRuns: 1000 },
    )
  })
})
