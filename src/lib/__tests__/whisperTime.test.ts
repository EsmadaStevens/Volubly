import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  formatCountdown,
  formatInviteLeft,
  inviteMsLeft,
  threadMsLeft,
  whisperPhase,
} from '../whisperTime'
import { INVITE_WINDOW_MS, THREAD_MS, WHISPER_STATUSES, type WhisperView } from '../whisperTypes'

const MIN = 60_000
const T0 = 1_800_000_000_000

type Timed = Pick<WhisperView, 'status' | 'createdAtMs' | 'acceptedAtMs'>
const pending = (ageMin: number): [Timed, number] => [{ status: 'requested', createdAtMs: T0, acceptedAtMs: null }, T0 + ageMin * MIN]
const accepted = (ageMin: number): [Timed, number] => [
  { status: 'accepted', createdAtMs: T0 - 5 * MIN, acceptedAtMs: T0 },
  T0 + ageMin * MIN,
]

describe('whisperPhase examples', () => {
  it('a pending invite is open at 14 minutes and expired at 16', () => {
    expect(whisperPhase(...pending(14))).toBe('invite_open')
    expect(whisperPhase(...pending(16))).toBe('invite_expired')
  })
  it('an accepted thread is open at 59 minutes and over at 61', () => {
    expect(whisperPhase(...accepted(59))).toBe('open')
    expect(whisperPhase(...accepted(61))).toBe('time_up')
  })
  it('uses the same boundaries as the rules: open before the end, over at the end', () => {
    expect(whisperPhase({ status: 'requested', createdAtMs: T0, acceptedAtMs: null }, T0 + INVITE_WINDOW_MS - 1)).toBe('invite_open')
    expect(whisperPhase({ status: 'requested', createdAtMs: T0, acceptedAtMs: null }, T0 + INVITE_WINDOW_MS)).toBe('invite_expired')
    expect(whisperPhase({ status: 'accepted', createdAtMs: T0, acceptedAtMs: T0 }, T0 + THREAD_MS - 1)).toBe('open')
    expect(whisperPhase({ status: 'accepted', createdAtMs: T0, acceptedAtMs: T0 }, T0 + THREAD_MS)).toBe('time_up')
  })
  it('an accepted whisper with no acceptedAt is never open', () => {
    expect(whisperPhase({ status: 'accepted', createdAtMs: T0, acceptedAtMs: null }, T0)).toBe('time_up')
  })
  it('declined and ended stay that way whatever the time', () => {
    expect(whisperPhase({ status: 'declined', createdAtMs: T0, acceptedAtMs: null }, T0)).toBe('declined')
    expect(whisperPhase({ status: 'ended', createdAtMs: T0, acceptedAtMs: T0 }, T0)).toBe('ended')
  })
})

describe('time left', () => {
  it('invite time left counts down from 15 minutes and is 0 for other statuses', () => {
    const w: Timed = { status: 'requested', createdAtMs: T0, acceptedAtMs: null }
    expect(inviteMsLeft(w, T0)).toBe(15 * MIN)
    expect(inviteMsLeft(w, T0 + 20 * MIN)).toBe(0)
    expect(inviteMsLeft({ ...w, status: 'accepted' }, T0)).toBe(0)
  })
  it('thread time left counts down from 1 hour and is 0 when not accepted', () => {
    const w: Timed = { status: 'accepted', createdAtMs: T0, acceptedAtMs: T0 }
    expect(threadMsLeft(w, T0 + 30 * MIN)).toBe(30 * MIN)
    expect(threadMsLeft(w, T0 + 90 * MIN)).toBe(0)
    expect(threadMsLeft({ ...w, status: 'ended' }, T0)).toBe(0)
    expect(threadMsLeft({ ...w, acceptedAtMs: null }, T0)).toBe(0)
  })
})

describe('formatting', () => {
  it('formats the countdown as mm:ss', () => {
    expect(formatCountdown(THREAD_MS)).toBe('60:00')
    expect(formatCountdown(42 * MIN + 10_000)).toBe('42:10')
    expect(formatCountdown(1)).toBe('00:01')
    expect(formatCountdown(0)).toBe('00:00')
    expect(formatCountdown(-5000)).toBe('00:00')
  })
  it('formats the invite time left', () => {
    expect(formatInviteLeft(14 * MIN + 59_000)).toBe('14 min left')
    expect(formatInviteLeft(15 * MIN)).toBe('15 min left')
    expect(formatInviteLeft(59_999)).toBe('Under a minute left')
    expect(formatInviteLeft(0)).toBe('Under a minute left')
    expect(formatInviteLeft(-1)).toBe('Under a minute left')
  })
})

const viewArb: fc.Arbitrary<Timed> = fc.record({
  status: fc.constantFrom(...WHISPER_STATUSES),
  createdAtMs: fc.integer({ min: T0 - 5 * THREAD_MS, max: T0 + 5 * THREAD_MS }),
  acceptedAtMs: fc.option(fc.integer({ min: T0 - 5 * THREAD_MS, max: T0 + 5 * THREAD_MS }), { nil: null }),
})
const nowArb = fc.integer({ min: T0 - 5 * THREAD_MS, max: T0 + 10 * THREAD_MS })

describe('whisperPhase properties', () => {
  it('exactly one phase holds, and open holds exactly when accepted and inside the hour', () => {
    fc.assert(
      fc.property(viewArb, nowArb, (w, now) => {
        const holds = {
          invite_open: w.status === 'requested' && now < w.createdAtMs + INVITE_WINDOW_MS,
          invite_expired: w.status === 'requested' && now >= w.createdAtMs + INVITE_WINDOW_MS,
          open: w.status === 'accepted' && w.acceptedAtMs !== null && now < w.acceptedAtMs + THREAD_MS,
          time_up: w.status === 'accepted' && !(w.acceptedAtMs !== null && now < w.acceptedAtMs + THREAD_MS),
          declined: w.status === 'declined',
          ended: w.status === 'ended',
        }
        const trueOnes = Object.entries(holds).filter(([, v]) => v).map(([k]) => k)
        expect(trueOnes).toHaveLength(1)
        expect(whisperPhase(w, now)).toBe(trueOnes[0])
      }),
    )
  })

  it('the countdown is never negative and never goes up as time passes', () => {
    fc.assert(
      fc.property(fc.integer({ min: -THREAD_MS, max: 2 * THREAD_MS }), fc.integer({ min: 0, max: THREAD_MS }), (ms, later) => {
        const seconds = (s: string) => {
          const m = /^(\d{2,}):(\d{2})$/.exec(s)
          expect(m).not.toBeNull()
          return Number(m![1]) * 60 + Number(m![2])
        }
        const a = seconds(formatCountdown(ms))
        const b = seconds(formatCountdown(ms - later))
        expect(a).toBeGreaterThanOrEqual(0)
        expect(b).toBeGreaterThanOrEqual(0)
        expect(b).toBeLessThanOrEqual(a)
      }),
    )
  })

  it('time left never goes up as time passes', () => {
    fc.assert(
      fc.property(viewArb, nowArb, fc.integer({ min: 0, max: THREAD_MS }), (w, now, step) => {
        expect(inviteMsLeft(w, now + step)).toBeLessThanOrEqual(inviteMsLeft(w, now))
        expect(threadMsLeft(w, now + step)).toBeLessThanOrEqual(threadMsLeft(w, now))
      }),
    )
  })
})
