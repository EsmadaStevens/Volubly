import type { Relation } from './whisperInbox'

export type PersonSheetStateName = 'loading' | 'ready' | 'blocked' | 'existing' | 'sending' | 'sent' | 'failed'

/**
 * Which state the invite sheet is in. Order matters: a finished invite or one in flight wins over
 * everything, then "still loading", then what we know about this person.
 *
 * - `loaded`: the block check is done and the person's whisper list has arrived.
 * - `blocked`: this person has blocked them. Unblock is offered, and Invite is not.
 * - `relation`: a live whisper or invite with them already exists, so the sheet links to it.
 * - `error`: the last try failed. The Invite button is offered again.
 */
export function personSheetState(i: {
  loaded: boolean
  blocked: boolean
  relation: Relation
  sending: boolean
  sent: boolean
  error: string | null
}): PersonSheetStateName {
  if (i.sent) return 'sent'
  if (i.sending) return 'sending'
  if (!i.loaded) return 'loading'
  if (i.blocked) return 'blocked'
  if (i.relation.kind !== 'none') return 'existing'
  return i.error ? 'failed' : 'ready'
}
