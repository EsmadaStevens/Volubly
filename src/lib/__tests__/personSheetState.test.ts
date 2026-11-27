import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { personSheetState } from '../personSheetState'
import type { Relation } from '../whisperInbox'

const none: Relation = { kind: 'none' }
const base = { loaded: true, blocked: false, relation: none, sending: false, sent: false, error: null as string | null }

describe('personSheetState', () => {
  it('loading until the block check and the whisper list have arrived', () => {
    expect(personSheetState({ ...base, loaded: false })).toBe('loading')
  })
  it('ready when nothing is in the way', () => {
    expect(personSheetState(base)).toBe('ready')
  })
  it('blocked: Unblock is offered instead of Invite', () => {
    expect(personSheetState({ ...base, blocked: true })).toBe('blocked')
  })
  it('existing: a live whisper or invite is linked instead of inviting again', () => {
    for (const kind of ['open', 'sent', 'received'] as const) {
      expect(personSheetState({ ...base, relation: { kind, id: 'w1' } })).toBe('existing')
    }
  })
  it('failed: the last try failed, and Invite is offered again', () => {
    expect(personSheetState({ ...base, error: 'x' })).toBe('failed')
  })
  it('sending and sent', () => {
    expect(personSheetState({ ...base, sending: true })).toBe('sending')
    expect(personSheetState({ ...base, sent: true })).toBe('sent')
  })

  it('property: sent wins, then sending, then loading, then blocked, then existing, then failed', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom<Relation>(none, { kind: 'open', id: 'a' }, { kind: 'sent', id: 'b' }, { kind: 'received', id: 'c' }),
        fc.boolean(),
        fc.boolean(),
        fc.option(fc.constant('err'), { nil: null }),
        (loaded, blocked, relation, sending, sent, error) => {
          const s = personSheetState({ loaded, blocked, relation, sending, sent, error })
          const expected = sent
            ? 'sent'
            : sending
              ? 'sending'
              : !loaded
                ? 'loading'
                : blocked
                  ? 'blocked'
                  : relation.kind !== 'none'
                    ? 'existing'
                    : error
                      ? 'failed'
                      : 'ready'
          expect(s).toBe(expected)
        },
      ),
    )
  })
})
