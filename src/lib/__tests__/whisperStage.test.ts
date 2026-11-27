import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { whisperStage } from '../whisperStage'
import { whisperPhase } from '../whisperTime'
import { THREAD_MS, WHISPER_STATUSES, type WhisperView } from '../whisperTypes'
import type { SubState } from '../whisperWatch'
import { MIN, NOW, openWhisper, whisperView } from './whisperFixtures'

const ready = (w: WhisperView): SubState<WhisperView> => ({ status: 'ready', data: w })
const stage = (sub: SubState<WhisperView>, over: { uid?: string; nowMs?: number; forcedEnd?: boolean } = {}) =>
  whisperStage({ sub, uid: over.uid ?? 'me', nowMs: over.nowMs ?? NOW, forcedEnd: over.forcedEnd ?? false })

describe('whisperStage', () => {
  it('loading and idle show loading; an error shows error; a refusal shows unavailable', () => {
    expect(stage({ status: 'idle' })).toBe('loading')
    expect(stage({ status: 'loading' })).toBe('loading')
    expect(stage({ status: 'error', message: 'x' })).toBe('error')
    expect(stage({ status: 'denied' })).toBe('unavailable')
  })

  it('a whisper that is not this person\'s is unavailable', () => {
    expect(stage(ready(whisperView({ inviterId: 'a', inviteeId: 'b' })))).toBe('unavailable')
  })

  it('a pending invite is shown to the invitee as a reply form and to the inviter as a waiting card', () => {
    expect(stage(ready(whisperView({ inviterId: 'them', inviteeId: 'me', createdAtMs: NOW - 5 * MIN })))).toBe('invite_invitee')
    expect(stage(ready(whisperView({ inviterId: 'me', inviteeId: 'them', createdAtMs: NOW - 5 * MIN })))).toBe('invite_inviter')
  })

  it('a stale invite says it expired', () => {
    expect(stage(ready(whisperView({ createdAtMs: NOW - 16 * MIN })))).toBe('invite_expired')
  })

  it('an accepted thread is open at 59 minutes and ended at 61', () => {
    expect(stage(ready(openWhisper(59)))).toBe('open')
    expect(stage(ready(openWhisper(61)))).toBe('ended')
  })

  it('declined and ended show the same ended stage, with no cause', () => {
    expect(stage(ready(whisperView({ status: 'declined' })))).toBe('ended')
    expect(stage(ready(whisperView({ status: 'ended', endedBy: 'them' })))).toBe('ended')
  })

  it('a forced end (a refused send at the hour mark) ends an open thread', () => {
    expect(stage(ready(openWhisper(59)), { forcedEnd: true })).toBe('ended')
  })

  it('property: open only when the phase is open and nothing forced the end; the stage never leaks an unrelated whisper', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...WHISPER_STATUSES),
        fc.integer({ min: 0, max: 3 * THREAD_MS }),
        fc.boolean(),
        fc.constantFrom('me', 'them', 'stranger'),
        fc.boolean(),
        (status, age, forced, uid, iAmInviter) => {
          const w = whisperView({
            status,
            inviterId: iAmInviter ? 'me' : 'them',
            inviteeId: iAmInviter ? 'them' : 'me',
            createdAtMs: NOW - age,
            acceptedAtMs: status === 'accepted' ? NOW - age : null,
          })
          const s = stage(ready(w), { uid, forcedEnd: forced })
          const member = uid === 'me' || uid === 'them'
          if (!member) expect(s).toBe('unavailable')
          if (s === 'open') {
            expect(member).toBe(true)
            expect(forced).toBe(false)
            expect(whisperPhase(w, NOW)).toBe('open')
          }
          if (member && whisperPhase(w, NOW) === 'open' && !forced) expect(s).toBe('open')
          if (s === 'invite_invitee') expect(w.inviteeId).toBe(uid)
          if (s === 'invite_inviter') expect(w.inviterId).toBe(uid)
        },
      ),
    )
  })
})
