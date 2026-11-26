import { MESSAGE_MAX_LENGTH, MESSAGE_MIN_INTERVAL_S } from '../types'
import { containsLink, explainSendError, inProbation, type SendErrorCode } from './messageUtils'
import type { SendResult } from './sendMessage'
import { SEND_CLOSED } from './whisperCopy'
import { THREAD_MS, type WhisperView } from './whisperTypes'

/**
 * What the shared MessageComposer needs to send into something other than a room: how to check a
 * draft before sending, how to send it, and how to word each problem. Rooms need none of this
 * (the composer has its own room path); a whisper passes one of these as `target`.
 */
export interface ComposerTarget {
  preCheck: (body: string, lastSentAtMs: number | null) => SendErrorCode | null
  send: (i: { messageId: string; body: string; lastSentAtMs: number | null }) => Promise<SendResult>
  explain: (code: SendErrorCode) => string
}

/** What the send function behind a target receives. `sendWhisperMessage` in whisperApi.ts has this shape. */
export interface WhisperSendInput {
  uid: string
  whisper: WhisperView
  messageId: string
  body: string
  recheck: () => SendErrorCode | null
}

/** Within this long before or after the end of the hour, a refused send is read as "the hour just ended". */
export const NEAR_HOUR_MS = 60_000

/** Is the device clock within 60 seconds either side of `acceptedAt` plus one hour? */
export function nearHourMark(w: Pick<WhisperView, 'acceptedAtMs'>, nowMs: number): boolean {
  if (w.acceptedAtMs === null) return false
  return Math.abs(nowMs - (w.acceptedAtMs + THREAD_MS)) <= NEAR_HOUR_MS
}

/**
 * The composer target for an open whisper.
 * - preCheck mirrors the rules in plain words, in the same order as the room pre-check.
 * - A closed thread is reported as `room_closed`, which `explain` words as "This whisper has ended".
 * - If a send fails and the hour has just ended (or is about to), `onClosed` is called and the
 *   person sees the closed wording, not a generic error. The page then switches to the ended view.
 */
export function makeWhisperTarget(i: {
  whisper: WhisperView
  uid: string
  createdAtMs: number
  onClosed: () => void
  send: (input: WhisperSendInput) => Promise<SendResult>
  now?: () => number
}): ComposerTarget {
  const now = i.now ?? Date.now

  const preCheck = (body: string, lastSentAtMs: number | null): SendErrorCode | null => {
    const text = body.trim()
    const at = now()
    if (text.length === 0) return 'empty'
    if (text.length > MESSAGE_MAX_LENGTH) return 'too_long'
    if (i.whisper.acceptedAtMs === null || at >= i.whisper.acceptedAtMs + THREAD_MS) return 'room_closed'
    if (lastSentAtMs !== null && at - lastSentAtMs < MESSAGE_MIN_INTERVAL_S * 1000) return 'rate_limited'
    if (inProbation(i.createdAtMs, at) && containsLink(text)) return 'probation_link'
    return null
  }

  return {
    preCheck,
    explain: (code) => (code === 'room_closed' ? SEND_CLOSED : explainSendError(code)),
    async send({ messageId, body, lastSentAtMs }) {
      const text = body.trim()
      const result = await i.send({
        uid: i.uid,
        whisper: i.whisper,
        messageId,
        body: text,
        recheck: () => preCheck(text, lastSentAtMs),
      })
      if (result.status !== 'failed') return result
      if (result.code === 'room_closed') {
        i.onClosed()
        return result
      }
      // 'blocked' is what a refusal by the rules looks like once the message was read back and not found.
      if (result.code === 'blocked' && nearHourMark(i.whisper, now())) {
        i.onClosed()
        return { status: 'failed', code: 'room_closed' }
      }
      return result
    },
  }
}
