import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AGE_BANDS } from '../../types'
import { buildInbox, canPickPerson, endActionFor, pendingInviteCount, relationWith, whispersAllowed } from '../whisperInbox'
import { whisperPhase } from '../whisperTime'
import { INVITE_WINDOW_MS, THREAD_MS, WHISPER_STATUSES, type WhisperView } from '../whisperTypes'

const MIN = 60_000
const NOW = 1_800_000_000_000
const ME = 'me'

let seq = 0
function view(over: Partial<WhisperView> = {}): WhisperView {
  seq += 1
  return {
    id: `w${seq}`,
    inviterId: 'them',
    inviteeId: ME,
    status: 'requested',
    createdAtMs: NOW - 5 * MIN,
    acceptedAtMs: null,
    endedBy: null,
    inviterSlot: 1,
    inviteeSlot: null,
    expiresAt: { toMillis: () => NOW } as unknown as WhisperView['expiresAt'],
    ...over,
  }
}
const accepted = (ageMin: number, over: Partial<WhisperView> = {}) =>
  view({ status: 'accepted', createdAtMs: NOW - ageMin * MIN - MIN, acceptedAtMs: NOW - ageMin * MIN, inviteeSlot: 1, ...over })

describe('buildInbox', () => {
  it('puts invites for me, open threads and my waiting invites in their own lists', () => {
    const inv = view({ id: 'inv' })
    const wait = view({ id: 'wait', inviterId: ME, inviteeId: 'them' })
    const open = accepted(10, { id: 'open' })
    const r = buildInbox([inv, wait, open], ME, NOW)
    expect(r.invites.map((w) => w.id)).toEqual(['inv'])
    expect(r.waiting.map((w) => w.id)).toEqual(['wait'])
    expect(r.open.map((w) => w.id)).toEqual(['open'])
  })

  it('leaves out declined, ended, expired and finished whispers', () => {
    const list = [
      view({ status: 'declined' }),
      view({ status: 'ended', endedBy: 'them' }),
      view({ createdAtMs: NOW - 16 * MIN }), // stale invite
      accepted(61), // time is up
      accepted(10, { status: 'ended', endedBy: ME }),
    ]
    expect(buildInbox(list, ME, NOW)).toEqual({ invites: [], open: [], waiting: [] })
  })

  it('keeps an invite at 14 minutes and drops it at 16', () => {
    expect(buildInbox([view({ createdAtMs: NOW - 14 * MIN })], ME, NOW).invites).toHaveLength(1)
    expect(buildInbox([view({ createdAtMs: NOW - 16 * MIN })], ME, NOW).invites).toHaveLength(0)
  })

  it('never lists my own sent invite as an invite for me', () => {
    const sent = view({ inviterId: ME, inviteeId: 'them' })
    const r = buildInbox([sent], ME, NOW)
    expect(r.invites).toHaveLength(0)
    expect(r.waiting).toHaveLength(1)
  })

  it('sorts invites soonest to expire first, open soonest to end first, waiting newest first', () => {
    const i1 = view({ id: 'i1', createdAtMs: NOW - 2 * MIN })
    const i2 = view({ id: 'i2', createdAtMs: NOW - 10 * MIN })
    const o1 = accepted(5, { id: 'o1' })
    const o2 = accepted(40, { id: 'o2' })
    const w1 = view({ id: 'w1', inviterId: ME, inviteeId: 'x', createdAtMs: NOW - 8 * MIN })
    const w2 = view({ id: 'w2', inviterId: ME, inviteeId: 'y', createdAtMs: NOW - 1 * MIN })
    const r = buildInbox([i1, i2, o1, o2, w1, w2], ME, NOW)
    expect(r.invites.map((w) => w.id)).toEqual(['i2', 'i1'])
    expect(r.open.map((w) => w.id)).toEqual(['o2', 'o1'])
    expect(r.waiting.map((w) => w.id)).toEqual(['w2', 'w1'])
  })

  it('counts pending invites for me', () => {
    const list = [view(), view(), view({ inviterId: ME, inviteeId: 'z' }), view({ createdAtMs: NOW - 20 * MIN })]
    expect(pendingInviteCount(list, ME, NOW)).toBe(2)
    expect(pendingInviteCount([], ME, NOW)).toBe(0)
  })
})

describe('relationWith', () => {
  it('finds an invite I sent and an invite I received', () => {
    const sent = view({ id: 's', inviterId: ME, inviteeId: 'p' })
    const got = view({ id: 'g', inviterId: 'q', inviteeId: ME })
    expect(relationWith([sent, got], ME, 'p', NOW)).toEqual({ kind: 'sent', id: 's' })
    expect(relationWith([sent, got], ME, 'q', NOW)).toEqual({ kind: 'received', id: 'g' })
  })
  it('finds an open thread in either direction and prefers it over an invite', () => {
    const open = accepted(10, { id: 'o', inviterId: 'p', inviteeId: ME })
    const invite = view({ id: 'i', inviterId: ME, inviteeId: 'p' })
    expect(relationWith([invite, open], ME, 'p', NOW)).toEqual({ kind: 'open', id: 'o' })
  })
  it('ignores finished whispers and other people', () => {
    const list = [view({ inviterId: ME, inviteeId: 'p', status: 'declined' }), accepted(61, { inviterId: ME, inviteeId: 'p' }), view({ inviterId: 'a', inviteeId: 'b' })]
    expect(relationWith(list, ME, 'p', NOW)).toEqual({ kind: 'none' })
  })
})

describe('endActionFor', () => {
  const w = (status: WhisperView['status']) => ({ status, inviterId: 'inviter', inviteeId: 'invitee' })
  it('invitee on a pending invite declines, inviter cancels', () => {
    expect(endActionFor(w('requested'), 'invitee')).toBe('decline')
    expect(endActionFor(w('requested'), 'inviter')).toBe('cancel')
  })
  it('either member ends an accepted thread', () => {
    expect(endActionFor(w('accepted'), 'invitee')).toBe('end')
    expect(endActionFor(w('accepted'), 'inviter')).toBe('end')
  })
  it('nothing to write for a finished whisper or for someone who is not a member', () => {
    expect(endActionFor(w('declined'), 'invitee')).toBeNull()
    expect(endActionFor(w('ended'), 'inviter')).toBeNull()
    expect(endActionFor(w('requested'), 'stranger')).toBeNull()
    expect(endActionFor(w('accepted'), 'stranger')).toBeNull()
  })
})

describe('whispersAllowed and canPickPerson', () => {
  it('whispers are not offered to under_13', () => {
    expect(whispersAllowed('under_13')).toBe(false)
    expect(whispersAllowed('13_17')).toBe(true)
    expect(whispersAllowed('18_plus')).toBe(true)
  })
  it('the invite sheet never opens for a simulated demo sender', () => {
    expect(canPickPerson({ senderId: 'sim1', uid: ME, simulated: true, viewerBand: '18_plus' })).toBe(false)
  })
  it('not for my own message or for an under_13 viewer, yes for a real message from someone else', () => {
    expect(canPickPerson({ senderId: ME, uid: ME, viewerBand: '18_plus' })).toBe(false)
    expect(canPickPerson({ senderId: 'p', uid: ME, viewerBand: 'under_13' })).toBe(false)
    expect(canPickPerson({ senderId: 'p', uid: ME, viewerBand: '13_17' })).toBe(true)
    expect(canPickPerson({ senderId: 'p', uid: ME, simulated: false, viewerBand: '18_plus' })).toBe(true)
  })
  it('property: only a real message from someone else, for a viewer who may use whispers', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), fc.boolean(), fc.constantFrom(...AGE_BANDS), (s, u, sim, band) => {
        expect(canPickPerson({ senderId: s, uid: u, simulated: sim, viewerBand: band })).toBe(!sim && s !== u && band !== 'under_13')
      }),
    )
  })
})

const idArb = fc.constantFrom('me', 'a', 'b', 'c')
const whisperArb: fc.Arbitrary<WhisperView> = fc
  .record({
    id: fc.uuid(),
    inviterId: idArb,
    inviteeId: idArb,
    status: fc.constantFrom(...WHISPER_STATUSES),
    createdAtMs: fc.integer({ min: NOW - 3 * THREAD_MS, max: NOW + MIN }),
    acceptedAtMs: fc.option(fc.integer({ min: NOW - 3 * THREAD_MS, max: NOW + MIN }), { nil: null }),
  })
  // The rules refuse an invite to yourself, so such a document cannot exist.
  .filter((r) => r.inviterId !== r.inviteeId)
  .map((r) => view(r))

describe('buildInbox properties', () => {
  it('lists only live whispers in the right section, in the right order', () => {
    fc.assert(
      fc.property(fc.array(whisperArb, { maxLength: 25 }), (list) => {
        const r = buildInbox(list, ME, NOW)
        for (const w of r.invites) {
          expect(whisperPhase(w, NOW)).toBe('invite_open')
          expect(w.inviteeId).toBe(ME)
          expect(w.inviterId).not.toBe(ME) // a sent invite is never an invite for me
        }
        for (const w of r.waiting) {
          expect(whisperPhase(w, NOW)).toBe('invite_open')
          expect(w.inviterId).toBe(ME)
        }
        for (const w of r.open) expect(whisperPhase(w, NOW)).toBe('open')
        for (const w of [...r.invites, ...r.waiting, ...r.open]) {
          expect(['declined', 'ended']).not.toContain(w.status)
        }
        const ids = [...r.invites, ...r.waiting, ...r.open].map((w) => w.id)
        expect(new Set(ids).size).toBe(ids.length)
        for (let i = 1; i < r.invites.length; i++) expect(r.invites[i].createdAtMs).toBeGreaterThanOrEqual(r.invites[i - 1].createdAtMs)
        for (let i = 1; i < r.open.length; i++) expect(r.open[i].acceptedAtMs!).toBeGreaterThanOrEqual(r.open[i - 1].acceptedAtMs!)
        for (let i = 1; i < r.waiting.length; i++) expect(r.waiting[i].createdAtMs).toBeLessThanOrEqual(r.waiting[i - 1].createdAtMs)
        expect(pendingInviteCount(list, ME, NOW)).toBe(r.invites.length)
      }),
    )
  })

  it('an invite window edge: nothing older than 15 minutes is listed as an invite', () => {
    fc.assert(
      fc.property(fc.array(whisperArb, { maxLength: 25 }), (list) => {
        for (const w of [...buildInbox(list, ME, NOW).invites, ...buildInbox(list, ME, NOW).waiting]) {
          expect(NOW - w.createdAtMs).toBeLessThan(INVITE_WINDOW_MS)
        }
      }),
    )
  })
})
