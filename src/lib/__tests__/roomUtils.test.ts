import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { closesAtMs, formatTimeLeft, HOUR_MS, isExpired, MINUTE_MS, msLeft, reasonLabel } from '../roomUtils'
import { ROOM_LIFETIME_MS } from '../../types'

describe('room lifetime', () => {
  it('closes exactly 24 hours after opening, never earlier or later', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_000_000_000_000 }), (opened) => {
        expect(closesAtMs(opened) - opened).toBe(24 * HOUR_MS)
        expect(closesAtMs(opened) - opened).toBe(ROOM_LIFETIME_MS)
      }),
    )
  })

  it('is open one millisecond before the 24 hour mark and closed at it', () => {
    const opened = 1_000_000
    expect(isExpired(opened, opened + 24 * HOUR_MS - 1)).toBe(false)
    expect(isExpired(opened, opened + 24 * HOUR_MS)).toBe(true)
    expect(isExpired(opened, opened + 24 * HOUR_MS + 1)).toBe(true)
  })

  it('never reports negative time left', () => {
    expect(msLeft(0, 10 * 24 * HOUR_MS)).toBe(0)
  })
})

describe('formatTimeLeft', () => {
  it('formats hours, minutes and the last minute', () => {
    expect(formatTimeLeft(14 * HOUR_MS + 22 * MINUTE_MS + 40_000)).toBe('14h 22m left')
    expect(formatTimeLeft(HOUR_MS)).toBe('1h 00m left')
    expect(formatTimeLeft(42 * MINUTE_MS)).toBe('42m left')
    expect(formatTimeLeft(30_000)).toBe('Under 1m left')
    expect(formatTimeLeft(0)).toBe('Closed')
  })
})

describe('reasonLabel', () => {
  it('explains a category match first', () => {
    expect(reasonLabel({ matchedPick: 'music', ageMs: 0, leftMs: 5 * MINUTE_MS })).toBe('In your Music picks')
  })
  it('falls back to plain descriptions and never uses engagement words', () => {
    const labels = [
      reasonLabel({ matchedPick: null, ageMs: HOUR_MS, leftMs: 30 * MINUTE_MS }),
      reasonLabel({ matchedPick: null, ageMs: 5 * MINUTE_MS, leftMs: 20 * HOUR_MS }),
      reasonLabel({ matchedPick: null, ageMs: 5 * HOUR_MS, leftMs: 19 * HOUR_MS }),
    ]
    expect(labels).toEqual(['Ending soon', 'Just opened', 'Live now'])
    for (const l of labels) expect(l).not.toMatch(/trending|hot|popular|active today/i)
  })
})
