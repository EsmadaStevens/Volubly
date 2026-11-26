import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { toWhisperView } from '../whisperData'

const ts = (ms: number) => ({ toMillis: () => ms })

const good = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  inviterId: 'alice',
  inviteeId: 'bob',
  memberIds: ['alice', 'bob'],
  status: 'requested',
  createdAt: ts(1000),
  acceptedAt: null,
  endedBy: null,
  inviterSlot: 2,
  inviteeSlot: null,
  expiresAt: ts(9000),
  ...over,
})

describe('toWhisperView', () => {
  it('maps a pending invite', () => {
    const v = toWhisperView('w1', good())
    expect(v).toMatchObject({
      id: 'w1',
      inviterId: 'alice',
      inviteeId: 'bob',
      status: 'requested',
      createdAtMs: 1000,
      acceptedAtMs: null,
      endedBy: null,
      inviterSlot: 2,
      inviteeSlot: null,
    })
    expect(v?.expiresAt.toMillis()).toBe(9000)
  })

  it('maps an accepted thread, and an ended one with endedBy', () => {
    const a = toWhisperView('w', good({ status: 'accepted', acceptedAt: ts(2000), inviteeSlot: 3 }))
    expect(a).toMatchObject({ status: 'accepted', acceptedAtMs: 2000, inviteeSlot: 3 })
    const e = toWhisperView('w', good({ status: 'ended', acceptedAt: ts(2000), inviteeSlot: 1, endedBy: 'bob' }))
    expect(e).toMatchObject({ status: 'ended', endedBy: 'bob' })
  })

  it('treats missing optional fields as null', () => {
    const d = good()
    delete d.acceptedAt
    delete d.endedBy
    delete d.inviteeSlot
    expect(toWhisperView('w', d)).toMatchObject({ acceptedAtMs: null, endedBy: null, inviteeSlot: null })
  })

  it.each([
    ['no inviterId', { inviterId: undefined }],
    ['empty inviteeId', { inviteeId: '' }],
    ['unknown status', { status: 'open' }],
    ['no createdAt (not yet resolved)', { createdAt: null }],
    ['createdAt not a time', { createdAt: 5 }],
    ['acceptedAt not a time', { acceptedAt: 'now' }],
    ['endedBy not a string', { endedBy: 7 }],
    ['inviterSlot 0', { inviterSlot: 0 }],
    ['inviterSlot 4', { inviterSlot: 4 }],
    ['inviterSlot a string', { inviterSlot: '1' }],
    ['inviteeSlot 4', { inviteeSlot: 4 }],
    ['no expiresAt', { expiresAt: undefined }],
  ])('returns null for %s', (_name, over) => {
    expect(toWhisperView('w', good(over))).toBeNull()
  })

  it('returns null for an empty id or missing data', () => {
    expect(toWhisperView('', good())).toBeNull()
    expect(toWhisperView('w', undefined)).toBeNull()
    expect(toWhisperView('w', null)).toBeNull()
  })

  it('never throws on random input', () => {
    fc.assert(
      fc.property(fc.string(), fc.anything(), (id, data) => {
        const r = toWhisperView(id, data as Record<string, unknown>)
        expect(r === null || typeof r === 'object').toBe(true)
      }),
    )
    fc.assert(
      fc.property(fc.dictionary(fc.constantFrom('inviterId', 'inviteeId', 'status', 'createdAt', 'inviterSlot', 'expiresAt'), fc.anything()), (d) => {
        expect(() => toWhisperView('w', d)).not.toThrow()
      }),
    )
  })
})
