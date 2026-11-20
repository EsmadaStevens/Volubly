import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { DELAY_CHOICES, holdMsLeft, isSpoilerLike, parseDelay } from '../spoiler'
import { simulatedSpoilers } from '../demoData'

describe('isSpoilerLike', () => {
  it('catches the usual give-aways', () => {
    for (const t of ['GOAL!!', 'GOOOOAL', 'he scored', 'penalty to them', 'red card!', 'sent off', 'it is 2-1 now', 'what a winner', 'wicket!', 'own goal lol']) {
      expect(isSpoilerLike(t), t).toBe(true)
    }
  })
  it('leaves ordinary chatter alone', () => {
    for (const t of ['kick off in two minutes', 'the keeper looks nervous', 'anyone got snacks?', 'my stream is lagging', 'what a game', 'hello there']) {
      expect(isSpoilerLike(t), t).toBe(false)
    }
  })
  it('the simulated spoiler examples are caught', () => {
    for (const m of simulatedSpoilers(1000, 0)) expect(isSpoilerLike(m.body)).toBe(true)
  })
})

describe('holdMsLeft', () => {
  it('counts down and never goes below zero', () => {
    expect(holdMsLeft(1000, 1000, 60)).toBe(60_000)
    expect(holdMsLeft(1000, 31_000, 60)).toBe(30_000)
    expect(holdMsLeft(1000, 61_000, 60)).toBe(0)
    expect(holdMsLeft(1000, 999_999, 60)).toBe(0)
  })
  it('no delay never holds anything', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1e9 }), fc.integer({ min: 0, max: 1e9 }), (sent, now) => holdMsLeft(sent, now, 0) === 0 || sent > now))
  })
  it('is never negative and never longer than the delay', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e9 }), fc.integer({ min: 0, max: 1e9 }), fc.constantFrom(...DELAY_CHOICES), (sent, now, d) => {
        const left = holdMsLeft(sent, now, d)
        return left >= 0 && (sent > now || left <= d * 1000)
      }),
    )
  })
})

describe('parseDelay', () => {
  it('accepts only the offered choices', () => {
    expect(parseDelay('60')).toBe(60)
    expect(parseDelay('45')).toBe(0)
    expect(parseDelay(null)).toBe(0)
    expect(parseDelay('abc')).toBe(0)
  })
})
