import { describe, expect, it } from 'vitest'
import { BACKGROUNDS, DEFAULT_BACKGROUND, contrast, resolveBackground } from '../background'

const INK = '#e6e0ec' // main text
const MUTED = '#ddbfca' // secondary text

describe('backgrounds', () => {
  it('have unique ids and labels, and the default is first', () => {
    expect(new Set(BACKGROUNDS.map((b) => b.id)).size).toBe(BACKGROUNDS.length)
    expect(new Set(BACKGROUNDS.map((b) => b.label)).size).toBe(BACKGROUNDS.length)
    expect(BACKGROUNDS[0]).toBe(DEFAULT_BACKGROUND)
  })

  it('fall back to the default for an unknown or missing id', () => {
    expect(resolveBackground('nope')).toBe(DEFAULT_BACKGROUND)
    expect(resolveBackground(null)).toBe(DEFAULT_BACKGROUND)
    expect(resolveBackground('ocean').id).toBe('ocean')
  })

  it('keep the main and secondary text easy to read on every colour they are made of', () => {
    for (const b of BACKGROUNDS) {
      for (const stop of b.stops) {
        expect(contrast(INK, stop), `${b.id} ${stop} vs main text`).toBeGreaterThanOrEqual(7)
        expect(contrast(MUTED, stop), `${b.id} ${stop} vs secondary text`).toBeGreaterThanOrEqual(7)
      }
    }
  })

  it('has a contrast check that is sound: black on white is 21, and a colour against itself is 1', () => {
    expect(Math.round(contrast('#000000', '#ffffff'))).toBe(21)
    expect(contrast('#336699', '#336699')).toBeCloseTo(1, 5)
  })
})
