import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { avatarCells, avatarHue } from '../avatar'

describe('avatar', () => {
  it('is deterministic for a seed', () => {
    expect(avatarCells('abc123')).toEqual(avatarCells('abc123'))
    expect(avatarHue('abc123')).toBe(avatarHue('abc123'))
  })

  it('is always mirrored, 5x5, with enough filled cells', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), (seed) => {
        const g = avatarCells(seed)
        expect(g).toHaveLength(5)
        for (const row of g) {
          expect(row).toHaveLength(5)
          expect(row[0]).toBe(row[4])
          expect(row[1]).toBe(row[3])
        }
        expect(g.flat().filter(Boolean).length).toBeGreaterThanOrEqual(5)
        const h = avatarHue(seed)
        expect(h).toBeGreaterThanOrEqual(0)
        expect(h).toBeLessThan(360)
      }),
    )
  })
})
