import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { classifyAcceptFailure, classifyInviteFailure } from '../whisperErrors'
import { INVITE_WINDOW_MS, WHISPER_STATUSES, type WhisperView } from '../whisperTypes'

const MIN = 60_000
const NOW = 1_800_000_000_000
const ME = 'me'

type Reread = Pick<WhisperView, 'status' | 'createdAtMs' | 'acceptedAtMs' | 'inviterId' | 'inviteeId'>
const w = (over: Partial<Reread> = {}): Reread => ({
  status: 'requested',
  createdAtMs: NOW - 5 * MIN,
  acceptedAtMs: null,
  inviterId: 'them',
  inviteeId: ME,
  ...over,
})

describe('classifyAcceptFailure', () => {
  it('accepted with me as invitee: the first attempt went through', () => {
    expect(classifyAcceptFailure(w({ status: 'accepted', acceptedAtMs: NOW }), ME, NOW)).toBe('accepted')
  })
  it('a stale invite: expired', () => {
    expect(classifyAcceptFailure(w({ createdAtMs: NOW - 16 * MIN }), ME, NOW)).toBe('invite_expired')
  })
  it('no longer requested (declined, ended, for example cancelled by the inviter): expired', () => {
    expect(classifyAcceptFailure(w({ status: 'declined' }), ME, NOW)).toBe('invite_expired')
    expect(classifyAcceptFailure(w({ status: 'ended' }), ME, NOW)).toBe('invite_expired')
  })
  it('still pending and inside the window: generic, the cause is something else', () => {
    expect(classifyAcceptFailure(w({ createdAtMs: NOW - 14 * MIN }), ME, NOW)).toBe('generic')
  })
  it('missing: generic', () => {
    expect(classifyAcceptFailure(null, ME, NOW)).toBe('generic')
  })
  it('a whisper where I am not the invitee: generic', () => {
    expect(classifyAcceptFailure(w({ status: 'accepted', acceptedAtMs: NOW, inviteeId: 'other' }), ME, NOW)).toBe('generic')
  })
  it('property: only a stale or finished invite is ever "expired", and a pending one in the window never is', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...WHISPER_STATUSES),
        fc.integer({ min: 0, max: 40 * MIN }),
        (status, age) => {
          const r = classifyAcceptFailure(w({ status, createdAtMs: NOW - age, acceptedAtMs: status === 'accepted' ? NOW : null }), ME, NOW)
          if (status === 'requested') expect(r).toBe(age >= INVITE_WINDOW_MS ? 'invite_expired' : 'generic')
          if (status === 'accepted') expect(r).toBe('accepted')
          if (status === 'declined' || status === 'ended') expect(r).toBe('invite_expired')
        },
      ),
    )
  })
})

describe('classifyInviteFailure', () => {
  it('requested with me as inviter: sent', () => {
    expect(classifyInviteFailure({ status: 'requested', inviterId: ME }, ME)).toBe('sent')
  })
  it.each([
    ['someone else is the inviter', { status: 'requested', inviterId: 'other' } as const],
    ['already accepted', { status: 'accepted', inviterId: ME } as const],
    ['declined', { status: 'declined', inviterId: ME } as const],
    ['ended', { status: 'ended', inviterId: ME } as const],
  ])('%s: generic', (_n, r) => {
    expect(classifyInviteFailure(r, ME)).toBe('generic')
  })
  it('missing: generic', () => {
    expect(classifyInviteFailure(null, ME)).toBe('generic')
  })
})
