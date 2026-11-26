import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { messagesFrom, messagesStateFrom, toSubError, whisperFrom, whisperListFrom, type SubState } from '../whisperWatch'
import type { MessageView } from '../../types'

const ts = (ms: number) => ({ toMillis: () => ms })
const good = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  inviterId: 'alice',
  inviteeId: 'bob',
  memberIds: ['alice', 'bob'],
  status: 'requested',
  createdAt: ts(1000),
  acceptedAt: null,
  endedBy: null,
  inviterSlot: 1,
  inviteeSlot: null,
  expiresAt: ts(9000),
  ...over,
})

describe('toSubError', () => {
  it('permission-denied is denied, anything else is an error with the plain message', () => {
    expect(toSubError({ code: 'permission-denied' }, 'msg')).toEqual({ status: 'denied' })
    expect(toSubError({ code: 'unavailable' }, 'msg')).toEqual({ status: 'error', message: 'msg' })
    expect(toSubError(new Error('x'), 'msg')).toEqual({ status: 'error', message: 'msg' })
    expect(toSubError(null, 'msg')).toEqual({ status: 'error', message: 'msg' })
  })
})

describe('whisperListFrom and whisperFrom', () => {
  it('maps good documents and skips malformed ones', () => {
    const list = whisperListFrom([
      { id: 'a', data: good() },
      { id: 'b', data: good({ status: 'nonsense' }) },
      { id: 'c', data: good({ createdAt: null }) },
    ])
    expect(list.map((w) => w.id)).toEqual(['a'])
  })
  it('a missing, empty or malformed single document is denied (not available)', () => {
    expect(whisperFrom({ id: 'a', exists: false, data: undefined })).toEqual({ status: 'denied' })
    expect(whisperFrom({ id: 'a', exists: true, data: undefined })).toEqual({ status: 'denied' })
    expect(whisperFrom({ id: 'a', exists: true, data: good({ inviterSlot: 9 }) })).toEqual({ status: 'denied' })
  })
  it('a good single document is ready', () => {
    const s = whisperFrom({ id: 'a', exists: true, data: good() })
    expect(s.status).toBe('ready')
    if (s.status === 'ready') expect(s.data.id).toBe('a')
  })
  it('never throws on random documents', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ id: fc.string(), data: fc.dictionary(fc.string(), fc.anything()) })), (docs) => {
        expect(() => whisperListFrom(docs)).not.toThrow()
      }),
    )
  })
})

describe('messagesFrom and messagesStateFrom', () => {
  const msg = (over: Record<string, unknown> = {}) => ({ senderId: 'bob', body: 'hi', sentAt: ts(5000), ...over })
  it('maps messages, keeps the pending flag, skips malformed ones', () => {
    const out = messagesFrom([
      { id: 'm1', data: msg(), pending: false },
      { id: 'm2', data: msg({ sentAt: null }), pending: true }, // server time not known yet and no estimate: skipped
      { id: 'm3', data: msg({ body: 5 }), pending: false },
      { id: 'm4', data: msg(), pending: true },
    ])
    expect(out.map((m) => [m.id, m.pending])).toEqual([['m1', false], ['m4', true]])
  })
  it('maps every state to what the shared message list understands', () => {
    const list: MessageView[] = []
    const cases: Array<[SubState<MessageView[]>, string]> = [
      [{ status: 'idle' }, 'closed'],
      [{ status: 'denied' }, 'closed'],
      [{ status: 'loading' }, 'loading'],
      [{ status: 'ready', data: list }, 'ready'],
      [{ status: 'error', message: 'm' }, 'error'],
    ]
    for (const [sub, expected] of cases) expect(messagesStateFrom(sub).status).toBe(expected)
    expect(messagesStateFrom({ status: 'error', message: 'm' })).toEqual({ status: 'error', message: 'm' })
  })
  it('a disabled listener holds no messages: idle maps to closed with nothing in it', () => {
    expect(messagesStateFrom({ status: 'idle' })).toEqual({ status: 'closed' })
  })
})
