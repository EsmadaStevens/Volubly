import { GENERIC_ERROR_TEXT, INVITE_EXPIRED_TEXT, TOO_MANY_TEXT } from './whisperCopy'
import { whisperPhase } from './whisperTime'
import type { WhisperView } from './whisperTypes'

/**
 * What the person is told when an invite, accept, end or block does not work.
 * Only two specific messages exist. Both are chosen from facts the client already has:
 * no free slot, or an invite whose time has run out. The reason a rule said no is never used,
 * so a block, an age mismatch and a full slot set on the other side all look the same.
 */
export type WhisperErrorCode = 'too_many' | 'invite_expired' | 'generic'

export function whisperErrorText(code: WhisperErrorCode): string {
  switch (code) {
    case 'too_many':
      return TOO_MANY_TEXT
    case 'invite_expired':
      return INVITE_EXPIRED_TEXT
    case 'generic':
      return GENERIC_ERROR_TEXT
  }
}

type Reread = Pick<WhisperView, 'status' | 'createdAtMs' | 'acceptedAtMs' | 'inviterId' | 'inviteeId'> | null

/**
 * After an accept failed (denied, timed out, or offline), the whisper is read once to find out why.
 * - accepted, and I am the invitee: the first attempt went through, so open the whisper.
 * - declined or ended, or a pending invite whose 15 minutes have passed: the invite expired.
 * - anything else, including a missing whisper: the generic message.
 */
export function classifyAcceptFailure(reread: Reread, uid: string, nowMs: number): 'accepted' | 'invite_expired' | 'generic' {
  if (!reread || reread.inviteeId !== uid) return 'generic'
  switch (reread.status) {
    case 'accepted':
      return 'accepted'
    case 'declined':
    case 'ended':
      return 'invite_expired'
    case 'requested':
      return whisperPhase(reread, nowMs) === 'invite_expired' ? 'invite_expired' : 'generic'
  }
}

/**
 * After an invite failed, the whisper is read once by its id. If it exists, is still waiting,
 * and I am the inviter, the first attempt went through and the sheet shows "Invite sent".
 * Anything else (not found, someone else's, already accepted) shows the generic message.
 */
export function classifyInviteFailure(reread: Pick<WhisperView, 'status' | 'inviterId'> | null, uid: string): 'sent' | 'generic' {
  return reread && reread.status === 'requested' && reread.inviterId === uid ? 'sent' : 'generic'
}
