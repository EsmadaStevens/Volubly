import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { containsLink, explainSendError, preCheckSend, resolveDenied, type SendErrorCode } from '../messageUtils'
import { toMessageView } from '../messageData'

const HOUR = 3600_000
const base = { body: 'hello', nowMs: 10 * HOUR, openedAtMs: 9 * HOUR, lastSentAtMs: null, createdAtMs: 0 }

// The same expression the database rules use, written out independently.
const rulesRegex = /^.*(https?:\/\/|www\.).*$/is

describe('containsLink', () => {
  it('matches the rules expression on any text', () => {
    fc.assert(fc.property(fc.string(), (s) => containsLink(s) === rulesRegex.test(s)))
  })
  it('catches common forms', () => {
    expect(containsLink('see HTTP://x.com')).toBe(true)
    expect(containsLink('go to www.x.com')).toBe(true)
    expect(containsLink('line one\nhttps://x.com')).toBe(true)
    expect(containsLink('just words')).toBe(false)
  })
})

describe('preCheckSend', () => {
  it('accepts a normal message', () => expect(preCheckSend(base)).toBeNull())
  it('rejects empty and too long', () => {
    expect(preCheckSend({ ...base, body: '   ' })).toBe('empty')
    expect(preCheckSend({ ...base, body: 'a'.repeat(281) })).toBe('too_long')
    expect(preCheckSend({ ...base, body: 'a'.repeat(280) })).toBeNull()
  })
  it('rejects a closed room', () => {
    expect(preCheckSend({ ...base, openedAtMs: 0, nowMs: 24 * HOUR })).toBe('room_closed')
  })
  it('rate limits at 3 seconds', () => {
    expect(preCheckSend({ ...base, lastSentAtMs: base.nowMs - 2000 })).toBe('rate_limited')
    expect(preCheckSend({ ...base, lastSentAtMs: base.nowMs - 3000 })).toBeNull()
  })
  it('blocks links only during the first hour', () => {
    expect(preCheckSend({ ...base, body: 'www.x.com', createdAtMs: base.nowMs - 1000 })).toBe('probation_link')
    expect(preCheckSend({ ...base, body: 'www.x.com', createdAtMs: base.nowMs - HOUR })).toBeNull()
  })
  it('every error has a plain explanation', () => {
    const codes: SendErrorCode[] = ['empty', 'too_long', 'room_closed', 'rate_limited', 'probation_link', 'offline', 'blocked']
    for (const c of codes) expect(explainSendError(c).length).toBeGreaterThan(5)
  })
})

describe('resolveDenied', () => {
  it('treats a message that exists and is ours as already sent', async () => {
    expect(await resolveDenied({ uid: 'u', readMessage: async () => ({ senderId: 'u' }), recheck: null })).toBe('already_sent')
  })
  it('ignores a message that belongs to someone else', async () => {
    expect(await resolveDenied({ uid: 'u', readMessage: async () => ({ senderId: 'x' }), recheck: 'rate_limited' })).toBe('rate_limited')
  })
  it('falls back to blocked when nothing explains it', async () => {
    expect(await resolveDenied({ uid: 'u', readMessage: async () => null, recheck: null })).toBe('blocked')
  })
  it('survives a failed read-back', async () => {
    expect(await resolveDenied({ uid: 'u', readMessage: async () => { throw new Error('x') }, recheck: 'room_closed' })).toBe('room_closed')
  })
})

describe('toMessageView', () => {
  const ts = { toMillis: () => 5 }
  it('maps a good document', () => {
    expect(toMessageView('m', { senderId: 's', body: 'hi', sentAt: ts }, true)).toEqual({ id: 'm', senderId: 's', body: 'hi', sentAtMs: 5, pending: true })
  })
  it('skips incomplete documents', () => {
    expect(toMessageView('m', { senderId: 's', body: 'hi', sentAt: null }, false)).toBeNull()
    expect(toMessageView('m', { body: 'hi', sentAt: ts }, false)).toBeNull()
  })
})
