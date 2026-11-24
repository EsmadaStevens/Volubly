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

import { avatarGradientId, avatarTraits, BODIES, EXTRAS, EYES, MOUTHS, TOPS } from '../avatar'

describe('avatar characters', () => {
  it('draws the same character for the same seed', () => {
    expect(avatarTraits('abc123')).toEqual(avatarTraits('abc123'))
    expect(avatarGradientId('abc123')).toBe(avatarGradientId('abc123'))
  })

  it('only ever picks known options and two clearly different colours', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), (seed) => {
        const t = avatarTraits(seed)
        expect(BODIES).toContain(t.body)
        expect(TOPS).toContain(t.top)
        expect(EYES).toContain(t.eyes)
        expect(MOUTHS).toContain(t.mouth)
        expect(EXTRAS).toContain(t.extra)
        expect(t.hue).toBeGreaterThanOrEqual(0)
        expect(t.hue).toBeLessThan(360)
        const gap = Math.min((t.hue2 - t.hue + 360) % 360, (t.hue - t.hue2 + 360) % 360)
        expect(gap).toBeGreaterThanOrEqual(40)
      }),
    )
  })

  it('gives plenty of variety: every option shows up and most characters are different', () => {
    const seeds = Array.from({ length: 600 }, (_, i) => `seed-${i}-${i * 7919}`)
    const all = seeds.map(avatarTraits)
    for (const [list, key] of [[BODIES, 'body'], [TOPS, 'top'], [EYES, 'eyes'], [MOUTHS, 'mouth'], [EXTRAS, 'extra']] as const) {
      expect(new Set(all.map((t) => t[key]))).toEqual(new Set(list))
    }
    const distinct = new Set(all.map((t) => JSON.stringify(t)))
    expect(distinct.size).toBeGreaterThan(550)
  })

  it('gives different seeds different gradient ids, so avatars on one page do not clash', () => {
    const ids = new Set(Array.from({ length: 200 }, (_, i) => avatarGradientId(`s${i}`)))
    expect(ids.size).toBe(200)
  })
})
