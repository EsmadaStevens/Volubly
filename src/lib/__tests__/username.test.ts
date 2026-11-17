import { describe, expect, it } from 'vitest'
import { checkUsername } from '../username'

describe('checkUsername', () => {
  it('accepts normal names and trims spaces', () => {
    expect(checkUsername('  lusaka_fan ')).toEqual({ ok: true, value: 'lusaka_fan' })
    expect(checkUsername('Esmada7')).toEqual({ ok: true, value: 'Esmada7' })
  })

  it('rejects too short, too long and odd characters', () => {
    expect(checkUsername('ab').ok).toBe(false)
    expect(checkUsername('a'.repeat(21)).ok).toBe(false)
    expect(checkUsername('no spaces').ok).toBe(false)
    expect(checkUsername('émoji😀').ok).toBe(false)
  })

  it('rejects names that look like staff or automation', () => {
    for (const n of ['admin', 'Admin_42', 'MODERATOR', 'volubly', 'Volubly99', 'bot', 'support_']) {
      expect(checkUsername(n).ok).toBe(false)
    }
  })

  it('does not reject harmless names that merely contain a reserved word', () => {
    expect(checkUsername('botswana_fan').ok).toBe(true)
    expect(checkUsername('modern_art').ok).toBe(true)
  })
})
