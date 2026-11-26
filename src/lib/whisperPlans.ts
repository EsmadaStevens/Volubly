import type { Timestamp } from 'firebase/firestore'
import { endActionFor } from './whisperInbox'
import type { SlotNumber, WhisperView } from './whisperTypes'

/**
 * Write plans: plain descriptions of the writes for one action. No Firebase code runs here.
 * applyPlan (whisperApply.ts) turns a plan into one Firestore batch, and the same function is used
 * by the emulator test, so the plans below are checked against the real rules.
 *
 * Each plan satisfies exactly one branch of firestore.rules (see design.md, "Write plans").
 */

/** Stands for serverTimestamp(). The rules require request.time for every status-change timestamp. */
export const SERVER_TIME = Object.freeze({ __serverTime: true as const })
export type ServerTime = typeof SERVER_TIME

export type PlanValue = string | number | boolean | null | ServerTime | Timestamp | PlanValue[]

export type Op =
  | { kind: 'set' | 'update'; path: string[]; data: Record<string, PlanValue> }
  | { kind: 'delete'; path: string[] }

export type Plan = Op[]

export const isServerTime = (v: unknown): v is ServerTime => v === SERVER_TIME

const whisperPath = (id: string) => ['whispers', id]
const slotPath = (uid: string, n: SlotNumber) => ['whisperSlots', `${uid}_${n}`]

/**
 * A new invite: the Whisper and the inviter's slot, in one batch.
 * `expiresAt` is only a cleanup hint; the slot copies it exactly (the rules require that).
 */
export function planInvite(i: {
  uid: string
  inviteeId: string
  whisperId: string
  slot: SlotNumber
  expiresAt: Timestamp
}): Plan {
  return [
    {
      kind: 'set',
      path: whisperPath(i.whisperId),
      data: {
        inviterId: i.uid,
        inviteeId: i.inviteeId,
        memberIds: [i.uid, i.inviteeId],
        status: 'requested',
        createdAt: SERVER_TIME,
        acceptedAt: null,
        endedBy: null,
        inviterSlot: i.slot,
        inviteeSlot: null,
        expiresAt: i.expiresAt,
      },
    },
    {
      kind: 'set',
      path: slotPath(i.uid, i.slot),
      data: { userId: i.uid, whisperId: i.whisperId, openedAt: SERVER_TIME, expiresAt: i.expiresAt },
    },
  ]
}

/** The invitee accepts: update the Whisper and write the invitee's slot, in one batch. */
export function planAccept(i: { uid: string; whisper: Pick<WhisperView, 'id' | 'expiresAt'>; slot: SlotNumber }): Plan {
  return [
    {
      kind: 'update',
      path: whisperPath(i.whisper.id),
      data: { status: 'accepted', acceptedAt: SERVER_TIME, inviteeSlot: i.slot },
    },
    {
      kind: 'set',
      path: slotPath(i.uid, i.slot),
      data: { userId: i.uid, whisperId: i.whisper.id, openedAt: SERVER_TIME, expiresAt: i.whisper.expiresAt },
    },
  ]
}

/** The invitee declines a pending invite. Sets only `status`. */
export function planDecline(whisperId: string): Plan {
  return [{ kind: 'update', path: whisperPath(whisperId), data: { status: 'declined' } }]
}

/** The inviter cancels a pending invite. */
export function planCancel(i: { uid: string; whisperId: string }): Plan {
  return [{ kind: 'update', path: whisperPath(i.whisperId), data: { status: 'ended', endedBy: i.uid } }]
}

/** Either member ends an accepted thread. */
export function planEnd(i: { uid: string; whisperId: string }): Plan {
  return [{ kind: 'update', path: whisperPath(i.whisperId), data: { status: 'ended', endedBy: i.uid } }]
}

/**
 * Block a person. When there is a whisper the rules still let this person end, the matching
 * decline, cancel or end goes in the same batch. For a whisper that is already over, only the block.
 */
export function planBlock(i: {
  uid: string
  otherId: string
  whisper: Pick<WhisperView, 'id' | 'status' | 'inviterId' | 'inviteeId'> | null
}): Plan {
  const plan: Plan = []
  if (i.whisper) {
    const action = endActionFor(i.whisper, i.uid)
    if (action === 'decline') plan.push(...planDecline(i.whisper.id))
    else if (action === 'cancel') plan.push(...planCancel({ uid: i.uid, whisperId: i.whisper.id }))
    else if (action === 'end') plan.push(...planEnd({ uid: i.uid, whisperId: i.whisper.id }))
  }
  plan.push({
    kind: 'set',
    path: ['users', i.uid, 'blocked', i.otherId],
    data: { blockedId: i.otherId, blockedAt: SERVER_TIME },
  })
  return plan
}

export function planUnblock(i: { uid: string; otherId: string }): Plan {
  return [{ kind: 'delete', path: ['users', i.uid, 'blocked', i.otherId] }]
}

/**
 * A message and the sender's rate-limit record, in one batch (the rules require both).
 * `set` on a rate-limit record that already exists is an update, which the rules accept.
 */
export function planMessage(i: {
  uid: string
  whisper: Pick<WhisperView, 'id' | 'expiresAt'>
  messageId: string
  body: string
}): Plan {
  return [
    {
      kind: 'set',
      path: ['whispers', i.whisper.id, 'messages', i.messageId],
      data: {
        messageId: i.messageId,
        senderId: i.uid,
        body: i.body,
        sentAt: SERVER_TIME,
        whisperId: i.whisper.id,
        expiresAt: i.whisper.expiresAt,
      },
    },
    {
      kind: 'set',
      path: ['whispers', i.whisper.id, 'rateLimits', i.uid],
      data: { userId: i.uid, lastMessageAt: SERVER_TIME, expiresAt: i.whisper.expiresAt },
    },
  ]
}
