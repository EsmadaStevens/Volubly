import type { AgeBandLabel } from '../types'
import { whisperPhase } from './whisperTime'
import type { WhisperView } from './whisperTypes'

export interface Inbox {
  /** Pending invites for this person, soonest to expire first. */
  invites: WhisperView[]
  /** Open threads, soonest to end first. */
  open: WhisperView[]
  /** Invites this person sent that are still waiting, newest first. */
  waiting: WhisperView[]
}

// Ties are broken by id so the order never depends on the order the database returned.
const byId = (a: WhisperView, b: WhisperView) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * The three lists the inbox shows. Declined, ended, expired and finished whispers are not listed.
 * All sorting happens here, because the query has no order (no composite index on the free plan).
 */
export function buildInbox(whispers: WhisperView[], uid: string, nowMs: number): Inbox {
  const invites: WhisperView[] = []
  const open: WhisperView[] = []
  const waiting: WhisperView[] = []
  for (const w of whispers) {
    const phase = whisperPhase(w, nowMs)
    if (phase === 'invite_open') {
      if (w.inviteeId === uid) invites.push(w)
      else if (w.inviterId === uid) waiting.push(w)
    } else if (phase === 'open' && (w.inviterId === uid || w.inviteeId === uid)) {
      open.push(w)
    }
  }
  invites.sort((a, b) => a.createdAtMs - b.createdAtMs || byId(a, b))
  open.sort((a, b) => (a.acceptedAtMs ?? 0) - (b.acceptedAtMs ?? 0) || byId(a, b))
  waiting.sort((a, b) => b.createdAtMs - a.createdAtMs || byId(a, b))
  return { invites, open, waiting }
}

/** How many pending invites are waiting for this person to answer. */
export function pendingInviteCount(whispers: WhisperView[], uid: string, nowMs: number): number {
  return buildInbox(whispers, uid, nowMs).invites.length
}

export type Relation = { kind: 'none' } | { kind: 'open' | 'sent' | 'received'; id: string }

/**
 * Is there already a live whisper or invite between these two people, in either direction?
 * An open thread wins over an invite. Among equals the newest wins.
 */
export function relationWith(whispers: WhisperView[], uid: string, otherUid: string, nowMs: number): Relation {
  let best: { rank: number; w: WhisperView; kind: 'open' | 'sent' | 'received' } | null = null
  for (const w of whispers) {
    const between =
      (w.inviterId === uid && w.inviteeId === otherUid) || (w.inviterId === otherUid && w.inviteeId === uid)
    if (!between) continue
    const phase = whisperPhase(w, nowMs)
    let kind: 'open' | 'sent' | 'received'
    let rank: number
    if (phase === 'open') {
      kind = 'open'
      rank = 2
    } else if (phase === 'invite_open') {
      kind = w.inviterId === uid ? 'sent' : 'received'
      rank = 1
    } else continue
    if (!best || rank > best.rank || (rank === best.rank && w.createdAtMs > best.w.createdAtMs)) best = { rank, w, kind }
  }
  return best ? { kind: best.kind, id: best.w.id } : { kind: 'none' }
}

export type EndAction = 'decline' | 'cancel' | 'end'

/**
 * Which update the rules allow this person to make to a whisper, if any.
 * Invitee on a pending invite: decline. Inviter on a pending invite: cancel.
 * Either member on an accepted thread: end. Anything else: nothing to write.
 */
export function endActionFor(w: Pick<WhisperView, 'status' | 'inviterId' | 'inviteeId'>, uid: string): EndAction | null {
  if (w.status === 'requested') {
    if (w.inviteeId === uid) return 'decline'
    if (w.inviterId === uid) return 'cancel'
    return null
  }
  if (w.status === 'accepted' && (w.inviterId === uid || w.inviteeId === uid)) return 'end'
  return null
}

/** Whispers are not offered to accounts in the youngest band. The rules also refuse them. */
export function whispersAllowed(band: AgeBandLabel): boolean {
  return band !== 'under_13'
}

/**
 * Can the viewer open the invite sheet from this message? Not for their own messages,
 * not for simulated demo senders (they are not real accounts), and not for a viewer who has no whispers.
 */
export function canPickPerson(i: {
  senderId: string
  uid: string
  simulated?: boolean
  viewerBand: AgeBandLabel
}): boolean {
  return !i.simulated && i.senderId !== i.uid && whispersAllowed(i.viewerBand)
}
