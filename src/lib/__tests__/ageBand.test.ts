import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { ageBandFromBirthDate } from '../ageBand'

const now = new Date(2026, 10, 17) // 17 Nov 2026, local time

describe('ageBandFromBirthDate', () => {
  it('puts the 13th birthday today in 13_17 and the day before in under_13', () => {
    expect(ageBandFromBirthDate('2013-11-17', now)).toBe('13_17')
    expect(ageBandFromBirthDate('2013-11-18', now)).toBe('under_13')
  })

  it('puts the 18th birthday today in 18_plus and the day before in 13_17', () => {
    expect(ageBandFromBirthDate('2008-11-17', now)).toBe('18_plus')
    expect(ageBandFromBirthDate('2008-11-18', now)).toBe('13_17')
  })

  it('handles a leap-day birthday', () => {
    expect(ageBandFromBirthDate('2008-02-29', new Date(2026, 1, 28))).toBe('13_17')
    expect(ageBandFromBirthDate('2008-02-29', new Date(2026, 2, 1))).toBe('18_plus')
  })

  it('rejects impossible, future and absurd dates', () => {
    for (const bad of ['', 'abc', '2026-13-01', '2026-02-30', '2027-01-01', '1850-01-01', '0050-01-01', '2013/11/17']) {
      expect(ageBandFromBirthDate(bad, now)).toBeNull()
    }
  })

  it('never gives an older person a younger band than a younger person', () => {
    const order = { under_13: 0, '13_17': 1, '18_plus': 2 } as const
    const day = fc.integer({ min: 0, max: 365 * 90 }).map((n) => {
      const d = new Date(2026, 10, 17)
      d.setDate(d.getDate() - n)
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return `${d.getFullYear()}-${mm}-${dd}`
    })
    fc.assert(
      fc.property(day, day, (a, b) => {
        const [older, younger] = a <= b ? [a, b] : [b, a]
        const bo = ageBandFromBirthDate(older, now)
        const by = ageBandFromBirthDate(younger, now)
        expect(bo).not.toBeNull()
        expect(by).not.toBeNull()
        expect(order[bo!]).toBeGreaterThanOrEqual(order[by!])
      }),
    )
  })
})
