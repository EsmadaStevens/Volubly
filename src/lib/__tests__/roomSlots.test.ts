import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { isSlotBusy, slotId, slotsToTry } from '../roomSlots'

const H = 3_600_000
const now = 100 * H

describe('roomSlots', () => {
  it('names slots from the uid', () => expect(slotId('abc', 2)).toBe('abc_2'))
  it('a slot is busy for 24 hours (plus a small margin), then free', () => {
    expect(isSlotBusy(null, now)).toBe(false)
    expect(isSlotBusy(now - 23 * H, now)).toBe(true)
    expect(isSlotBusy(now - 24 * H, now)).toBe(true) // inside the safety margin
    expect(isSlotBusy(now - 24 * H - 61_000, now)).toBe(false)
  })
  it('no free slot means at the limit', () => {
    expect(slotsToTry([{ n: 1, openedAtMs: now - H }, { n: 2, openedAtMs: now - 2 * H }], now)).toEqual([])
  })
  it('prefers never-used slots, then the oldest', () => {
    expect(slotsToTry([{ n: 1, openedAtMs: now - 30 * H }, { n: 2, openedAtMs: null }], now)).toEqual([2, 1])
    expect(slotsToTry([{ n: 1, openedAtMs: now - 30 * H }, { n: 2, openedAtMs: now - 40 * H }], now)).toEqual([2, 1])
  })
  it('never offers a busy slot', () => {
    fc.assert(
      fc.property(fc.array(fc.option(fc.integer({ min: 0, max: now }), { nil: null }), { minLength: 2, maxLength: 2 }), (opened) => {
        const slots = opened.map((o, i) => ({ n: (i + 1) as 1 | 2, openedAtMs: o }))
        for (const n of slotsToTry(slots, now)) expect(isSlotBusy(slots[n - 1].openedAtMs, now)).toBe(false)
      }),
    )
  })
})
