import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { EMOJI_GROUPS, insertAt } from '../emoji'

describe('EMOJI_GROUPS', () => {
  it('has several non-empty groups with unique ids', () => {
    expect(EMOJI_GROUPS.length).toBeGreaterThanOrEqual(4)
    expect(new Set(EMOJI_GROUPS.map((g) => g.id)).size).toBe(EMOJI_GROUPS.length)
    for (const g of EMOJI_GROUPS) expect(g.emoji.length).toBeGreaterThan(10)
  })

  it('has no empty entries and no duplicates across the whole set', () => {
    const all = EMOJI_GROUPS.flatMap((g) => g.emoji)
    expect(all.every((e) => e.trim().length > 0)).toBe(true)
    expect(new Set(all).size).toBe(all.length)
  })

  it('uses plain emoji only: no letters, digits or spaces mixed in, and each one is short', () => {
    for (const e of EMOJI_GROUPS.flatMap((g) => g.emoji)) {
      expect(/[A-Za-z0-9\s]/.test(e)).toBe(false)
      expect(e.length).toBeLessThanOrEqual(3)
    }
  })
})

describe('insertAt', () => {
  it('inserts at the cursor and moves the cursor after it', () => {
    expect(insertAt('hello world', 5, 5, '😀', 280)).toEqual({ text: 'hello😀 world', cursor: 7 })
  })

  it('replaces selected text', () => {
    expect(insertAt('hello world', 6, 11, '🔥', 280)).toEqual({ text: 'hello 🔥', cursor: 8 })
  })

  it('adds at the end of an empty box', () => {
    expect(insertAt('', 0, 0, '👍', 280)).toEqual({ text: '👍', cursor: 2 })
  })

  it('refuses when it would go over the limit (control: one less fits)', () => {
    const full = 'a'.repeat(279)
    expect(insertAt(full, 279, 279, '😀', 280)).toBeNull() // 😀 counts as 2
    expect(insertAt('a'.repeat(278), 278, 278, '😀', 280)).not.toBeNull()
  })

  it('counts a replaced selection when checking the limit', () => {
    const t = 'a'.repeat(280)
    expect(insertAt(t, 0, 10, '😀', 280)).not.toBeNull()
    expect(insertAt(t, 0, 0, '😀', 280)).toBeNull()
  })

  it('clamps a cursor that is out of range instead of throwing', () => {
    expect(insertAt('ab', 99, 120, '😀', 280)?.text).toBe('ab😀')
    expect(insertAt('ab', -5, -1, '😀', 280)?.text).toBe('😀ab')
  })

  it('never exceeds the limit and never loses the original text, for any cursor', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 280 }), fc.nat(300), fc.nat(300), fc.constantFrom(...EMOJI_GROUPS.flatMap((g) => g.emoji)), (text, a, b, e) => {
        const r = insertAt(text, a, b, e, 280)
        if (r === null) return true
        const start = Math.min(Math.max(a, 0), text.length)
        const end = Math.max(start, Math.min(b, text.length))
        return r.text.length <= 280 && r.text.startsWith(text.slice(0, start)) && r.text.endsWith(text.slice(end)) && r.text.includes(e)
      }),
    )
  })
})
