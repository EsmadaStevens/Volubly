import { MESSAGE_MAX_LENGTH, MESSAGE_MIN_INTERVAL_S, PROBATION_DURATION_S } from '../types'
import { isExpired } from './roomUtils'

export type SendErrorCode =
  | 'empty'
  | 'too_long'
  | 'room_closed'
  | 'rate_limited'
  | 'probation_link'
  | 'offline'
  | 'blocked'

/** Mirrors hasNoUrl() in firestore.rules: http(s):// or www. anywhere, any case, any line. */
export function containsLink(text: string): boolean {
  return /(https?:\/\/|www\.)/i.test(text)
}

export function inProbation(createdAtMs: number, nowMs: number): boolean {
  return nowMs < createdAtMs + PROBATION_DURATION_S * 1000
}

export interface PreCheckInput {
  body: string
  nowMs: number
  openedAtMs: number
  lastSentAtMs: number | null
  createdAtMs: number
}

/**
 * A quick check before sending, only to explain problems in plain words.
 * The database rules are the real enforcement; this never replaces them.
 */
export function preCheckSend(i: PreCheckInput): SendErrorCode | null {
  const body = i.body.trim()
  if (body.length === 0) return 'empty'
  if (body.length > MESSAGE_MAX_LENGTH) return 'too_long'
  if (isExpired(i.openedAtMs, i.nowMs)) return 'room_closed'
  if (i.lastSentAtMs !== null && i.nowMs - i.lastSentAtMs < MESSAGE_MIN_INTERVAL_S * 1000) return 'rate_limited'
  if (inProbation(i.createdAtMs, i.nowMs) && containsLink(body)) return 'probation_link'
  return null
}

export function explainSendError(code: SendErrorCode): string {
  switch (code) {
    case 'empty':
      return 'Write something first.'
    case 'too_long':
      return `Messages can be up to ${MESSAGE_MAX_LENGTH} characters.`
    case 'room_closed':
      return 'This room has closed, so messages can no longer be sent.'
    case 'rate_limited':
      return `Slow down a little: one message every ${MESSAGE_MIN_INTERVAL_S} seconds.`
    case 'probation_link':
      return "New accounts can't post links during their first hour."
    case 'offline':
      return "You seem to be offline, so your message wasn't sent. Try again when you're back online."
    case 'blocked':
      return "Your message wasn't sent. Please try again."
  }
}

/**
 * The database said "permission denied". That is also what a harmless retry of a message
 * that already went through looks like (writing the same message again counts as an update,
 * which the rules refuse). So read the message back first. If it is there and it is ours,
 * the send actually worked. Otherwise explain the most likely cause.
 */
export async function resolveDenied(args: {
  uid: string
  readMessage: () => Promise<{ senderId?: string } | null>
  recheck: SendErrorCode | null
}): Promise<'already_sent' | SendErrorCode> {
  try {
    const existing = await args.readMessage()
    if (existing && existing.senderId === args.uid) return 'already_sent'
  } catch {
    /* could not read it back; fall through to the explanation */
  }
  return args.recheck ?? 'blocked'
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
