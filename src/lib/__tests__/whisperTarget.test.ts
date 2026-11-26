import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { explainSendError, type SendErrorCode } from '../messageUtils'
import type { SendResult } from '../sendMessage'
import { SEND_CLOSED } from '../whisperCopy'
import { makeWhisperTarget, nearHourMark, NEAR_HOUR_MS, type WhisperSendInput } from '../whisperTarget'
import { THREAD_MS, type WhisperView } from '../whisperTypes'

const MIN = 60_000
const NOW = 1_800_000_000_000

const whisper = (acceptedAgoMin = 10): WhisperView => ({
  id: 'w1',
  inviterId: 'alice',
  inviteeId: 'bob',
  status: 'accepted',
  createdAtMs: NOW - (acceptedAgoMin + 5) * MIN,
  acceptedAtMs: NOW - acceptedAgoMin * MIN,
  endedBy: null,
  inviterSlot: 1,
  inviteeSlot: 1,
  expiresAt: { toMillis: () => NOW } as unknown as WhisperView['expiresAt'],
})

const OLD_ACCOUNT = NOW - 48 * 60 * MIN
const NEW_ACCOUNT = NOW - 10 * MIN // in its first hour: links are refused

function target(over: { whisper?: WhisperView; createdAtMs?: number; send?: (i: WhisperSendInput) => Promise<SendResult>; now?: number } = {}) {
  const onClosed = vi.fn()
  const send = over.send ?? vi.fn(async (): Promise<SendResult> => ({ status: 'sent' }))
  const t = makeWhisperTarget({
    whisper: over.whisper ?? whisper(),
    uid: 'bob',
    createdAtMs: over.createdAtMs ?? OLD_ACCOUNT,
    onClosed,
    send,
    now: () => over.now ?? NOW,
  })
  return { t, onClosed, send }
}

describe('preCheck', () => {
  it('passes a normal message', () => {
    expect(target().t.preCheck('hello there', null)).toBeNull()
  })
  it('refuses an empty draft and one over 280 characters, and allows exactly 280', () => {
    const { t } = target()
    expect(t.preCheck('   ', null)).toBe('empty')
    expect(t.preCheck('x'.repeat(281), null)).toBe('too_long')
    expect(t.preCheck('x'.repeat(280), null)).toBeNull()
  })
  it('refuses a send 2 seconds after the last one and allows one 3 seconds after', () => {
    const { t } = target()
    expect(t.preCheck('hi', NOW - 2000)).toBe('rate_limited')
    expect(t.preCheck('hi', NOW - 3000)).toBeNull()
  })
  it('refuses a link in the first hour of an account, and not after it', () => {
    expect(target({ createdAtMs: NEW_ACCOUNT }).t.preCheck('see www.example.com', null)).toBe('probation_link')
    expect(target({ createdAtMs: NEW_ACCOUNT }).t.preCheck('see https://example.com', null)).toBe('probation_link')
    expect(target({ createdAtMs: NEW_ACCOUNT }).t.preCheck('no link here', null)).toBeNull()
    expect(target({ createdAtMs: OLD_ACCOUNT }).t.preCheck('see www.example.com', null)).toBeNull()
  })
  it('a closed thread gives room_closed: 61 minutes after acceptance, but not 59', () => {
    expect(target({ whisper: whisper(61) }).t.preCheck('hi', null)).toBe('room_closed')
    expect(target({ whisper: whisper(59) }).t.preCheck('hi', null)).toBeNull()
  })
  it('a whisper with no acceptedAt is closed', () => {
    expect(target({ whisper: { ...whisper(), acceptedAtMs: null } }).t.preCheck('hi', null)).toBe('room_closed')
  })
})

describe('explain', () => {
  it('words the closed code for a whisper', () => {
    expect(target().t.explain('room_closed')).toBe(SEND_CLOSED)
    expect(SEND_CLOSED).toBe('This whisper has ended, so messages can no longer be sent.')
  })
  it('uses the room wording for every other code', () => {
    const codes: SendErrorCode[] = ['empty', 'too_long', 'rate_limited', 'probation_link', 'offline', 'blocked']
    for (const c of codes) expect(target().t.explain(c)).toBe(explainSendError(c))
  })
})

describe('nearHourMark', () => {
  const at = (offsetMs: number) => nearHourMark({ acceptedAtMs: NOW - THREAD_MS + offsetMs }, NOW)
  it('is true within 60 seconds either side of the end of the hour', () => {
    expect(at(-30_000)).toBe(true) // 30 s before
    expect(at(30_000)).toBe(true) // 30 s after
    expect(at(0)).toBe(true)
  })
  it('is false 5 minutes either side, and with no acceptedAt', () => {
    expect(at(-5 * MIN)).toBe(false)
    expect(at(5 * MIN)).toBe(false)
    expect(nearHourMark({ acceptedAtMs: null }, NOW)).toBe(false)
  })
  it('property: symmetric around the hour mark', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 * MIN }), (d) => {
        expect(at(-d)).toBe(at(d))
        expect(at(d)).toBe(d <= NEAR_HOUR_MS)
      }),
    )
  })
})

describe('send', () => {
  it('passes a sent result through, with the trimmed body and a recheck', async () => {
    const send = vi.fn(async (): Promise<SendResult> => ({ status: 'sent' }))
    const { t, onClosed } = target({ send })
    expect(await t.send({ messageId: 'm1', body: '  hello  ', lastSentAtMs: null })).toEqual({ status: 'sent' })
    expect(send).toHaveBeenCalledOnce()
    const arg = (send.mock.calls as unknown as WhisperSendInput[][])[0][0]
    expect(arg).toMatchObject({ uid: 'bob', messageId: 'm1', body: 'hello' })
    expect(arg.whisper.id).toBe('w1')
    expect(arg.recheck()).toBeNull()
    expect(onClosed).not.toHaveBeenCalled()
  })

  it('passes already_sent through', async () => {
    const { t } = target({ send: async () => ({ status: 'already_sent' }) })
    expect(await t.send({ messageId: 'm', body: 'x', lastSentAtMs: null })).toEqual({ status: 'already_sent' })
  })

  it('a refused send 30 seconds before the hour ends calls onClosed and says the whisper ended', async () => {
    const { t, onClosed } = target({
      whisper: { ...whisper(), acceptedAtMs: NOW - THREAD_MS + 30_000 }, // the hour ends 30 seconds from now
      send: async () => ({ status: 'failed', code: 'blocked' }),
    })
    expect(await t.send({ messageId: 'm', body: 'x', lastSentAtMs: null })).toEqual({ status: 'failed', code: 'room_closed' })
    expect(onClosed).toHaveBeenCalledOnce()
  })

  it('a refused send 30 seconds after the hour ended also calls onClosed', async () => {
    const { t, onClosed } = target({
      whisper: { ...whisper(), acceptedAtMs: NOW - THREAD_MS - 30_000 },
      send: async () => ({ status: 'failed', code: 'blocked' }),
    })
    expect(await t.send({ messageId: 'm', body: 'x', lastSentAtMs: null })).toEqual({ status: 'failed', code: 'room_closed' })
    expect(onClosed).toHaveBeenCalledOnce()
  })

  it('a refused send 5 minutes before the hour ends does not: the generic send error stays', async () => {
    const { t, onClosed } = target({
      whisper: { ...whisper(), acceptedAtMs: NOW - THREAD_MS + 5 * MIN },
      send: async () => ({ status: 'failed', code: 'blocked' }),
    })
    expect(await t.send({ messageId: 'm', body: 'x', lastSentAtMs: null })).toEqual({ status: 'failed', code: 'blocked' })
    expect(onClosed).not.toHaveBeenCalled()
  })

  it('a send that failed because of the connection near the hour is not read as the end', async () => {
    const { t, onClosed } = target({
      whisper: { ...whisper(), acceptedAtMs: NOW - THREAD_MS + 20_000 },
      send: async () => ({ status: 'failed', code: 'offline' }),
    })
    expect(await t.send({ messageId: 'm', body: 'x', lastSentAtMs: null })).toEqual({ status: 'failed', code: 'offline' })
    expect(onClosed).not.toHaveBeenCalled()
  })

  it('a send that already reports the thread closed calls onClosed', async () => {
    const { t, onClosed } = target({ send: async () => ({ status: 'failed', code: 'room_closed' }) })
    expect(await t.send({ messageId: 'm', body: 'x', lastSentAtMs: null })).toEqual({ status: 'failed', code: 'room_closed' })
    expect(onClosed).toHaveBeenCalledOnce()
  })

  it('the recheck handed to the send reports the thread closed once the hour has passed', async () => {
    let recheck: (() => SendErrorCode | null) | null = null
    const { t } = target({
      whisper: { ...whisper(), acceptedAtMs: NOW - THREAD_MS - 1000 },
      send: async (i) => {
        recheck = i.recheck
        return { status: 'sent' }
      },
    })
    await t.send({ messageId: 'm', body: 'x', lastSentAtMs: null })
    expect(recheck!()).toBe('room_closed')
  })
})

describe('preCheck property', () => {
  it('a 1 to 280 character body with no link, 3 s or more after the last send, inside the hour, gives no problem', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 280 }).filter((s) => s.trim().length > 0 && s.trim().length <= 280 && !/(https?:\/\/|www\.)/i.test(s)),
        fc.option(fc.integer({ min: 3000, max: 10 * MIN }), { nil: null }),
        fc.integer({ min: 1, max: 58 }),
        (body, sinceLast, acceptedAgoMin) => {
          const { t } = target({ whisper: whisper(acceptedAgoMin) })
          expect(t.preCheck(body, sinceLast === null ? null : NOW - sinceLast)).toBeNull()
        },
      ),
    )
  })
})
