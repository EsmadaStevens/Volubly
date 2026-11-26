import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { NAME_CHANGE_COOLDOWN_MS, checkProfileChange, nameChangeWaitMs, waitText } from '../profileEdit'

const me = { username: 'Human_1', avatarSeed: 'aaa' }
const T = 10_000_000

describe('nameChangeWaitMs', () => {
  it('has no wait when the name was never changed, or the cooldown has passed', () => {
    expect(nameChangeWaitMs(null, T)).toBe(0)
    expect(nameChangeWaitMs(T - NAME_CHANGE_COOLDOWN_MS - 1000, T)).toBe(0)
  })

  it('says how long is left, and never goes below zero', () => {
    expect(nameChangeWaitMs(T - 60_000, T)).toBe(NAME_CHANGE_COOLDOWN_MS - 60_000)
    fc.assert(
      fc.property(fc.nat(10_000_000), (ago) => {
        expect(nameChangeWaitMs(T - ago, T)).toBeGreaterThanOrEqual(0)
      }),
    )
  })

  it('words the wait in whole minutes, at least one', () => {
    expect(waitText(1000)).toBe('You can change your name again in 1 minute.')
    expect(waitText(61_000)).toBe('You can change your name again in 2 minutes.')
  })
})

describe('checkProfileChange', () => {
  it('allows a new avatar at any time, even right after a name change', () => {
    const r = checkProfileChange(me, { username: 'Human_1', avatarSeed: 'bbb' }, T - 1000, T)
    expect(r).toEqual({ ok: true, profile: { username: 'Human_1', avatarSeed: 'bbb' }, nameChanged: false, changed: true })
  })

  it('allows a new name when none was changed recently (control for the next test)', () => {
    const r = checkProfileChange(me, { username: 'Brand_New', avatarSeed: 'aaa' }, null, T)
    expect(r).toMatchObject({ ok: true, nameChanged: true, changed: true })
  })

  it('refuses a new name inside the cooldown, with the wait in the message', () => {
    const r = checkProfileChange(me, { username: 'Brand_New', avatarSeed: 'aaa' }, T - 60_000, T)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/minute/)
  })

  it('applies the same name rules as sign-up: too short, bad characters, reserved names', () => {
    for (const bad of ['ab', 'has space', 'Admin_7', 'x'.repeat(21)]) {
      expect(checkProfileChange(me, { username: bad, avatarSeed: 'aaa' }, null, T).ok).toBe(false)
    }
    expect(checkProfileChange(me, { username: 'Fine_Name', avatarSeed: 'aaa' }, null, T).ok).toBe(true)
  })

  it('reports no change when nothing differs, and trims spaces around the name', () => {
    expect(checkProfileChange(me, { username: 'Human_1', avatarSeed: 'aaa' }, null, T)).toMatchObject({ ok: true, changed: false })
    expect(checkProfileChange(me, { username: '  Human_1  ', avatarSeed: 'aaa' }, null, T)).toMatchObject({ ok: true, changed: false })
  })

  it('never lets a refused change through, for any name', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (name) => {
        const r = checkProfileChange(me, { username: name, avatarSeed: 'aaa' }, T - 1000, T)
        if (r.ok) expect(r.nameChanged).toBe(false) // inside the cooldown only an unchanged name can pass
      }),
    )
  })
})
