import { describe, expect, it } from 'vitest'
import { checkRoomTitle } from '../roomTitle'
import { parsePicks } from '../picks'
import { toRoomView } from '../roomData'

describe('checkRoomTitle', () => {
  it('tidies spaces and enforces 3 to 60 characters', () => {
    expect(checkRoomTitle('  Zambia   vs  Ghana ')).toEqual({ ok: true, value: 'Zambia vs Ghana' })
    expect(checkRoomTitle('ab').ok).toBe(false)
    expect(checkRoomTitle('   ').ok).toBe(false)
    expect(checkRoomTitle('x'.repeat(61)).ok).toBe(false)
    expect(checkRoomTitle('x'.repeat(60)).ok).toBe(true)
  })
})

describe('parsePicks', () => {
  it('keeps valid categories once and drops anything else', () => {
    expect(parsePicks('["music","film","music"]')).toEqual(['music', 'film'])
    expect(parsePicks('["music","nonsense",5]')).toEqual(['music'])
    expect(parsePicks('not json')).toEqual([])
    expect(parsePicks('{"a":1}')).toEqual([])
    expect(parsePicks(null)).toEqual([])
  })
})

describe('toRoomView', () => {
  const ts = (ms: number) => ({ toMillis: () => ms })
  const good = {
    type: 'live_room',
    title: 'Match night',
    maturityLabel: 'all_ages',
    categories: ['sport', 'bogus'],
    openedAt: ts(123),
    postingParticipantCount: 4,
    createdBy: 'u1',
  }
  it('flattens a good document and drops unknown categories', () => {
    expect(toRoomView('r1', good)).toEqual({
      id: 'r1',
      type: 'live_room',
      title: 'Match night',
      maturityLabel: 'all_ages',
      categories: ['sport'],
      openedAtMs: 123,
      postingParticipantCount: 4,
      createdBy: 'u1',
    })
  })
  it('rejects malformed documents instead of crashing', () => {
    expect(toRoomView('r', { ...good, openedAt: null })).toBeNull()
    expect(toRoomView('r', { ...good, title: 5 })).toBeNull()
    expect(toRoomView('r', { ...good, maturityLabel: 'x' })).toBeNull()
    expect(toRoomView('r', { ...good, type: 'y' })).toBeNull()
  })
})
