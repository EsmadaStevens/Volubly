import { collection, doc, getDoc, getDocs, query, Timestamp, where } from 'firebase/firestore'
import { db } from './firebase'
import { resolveDenied, type SendErrorCode } from './messageUtils'
import type { SendResult } from './sendMessage'
import { commitPlan } from './whisperApply'
import { toWhisperView } from './whisperData'
import { classifyAcceptFailure, classifyInviteFailure, type WhisperErrorCode } from './whisperErrors'
import { endActionFor } from './whisperInbox'
import {
  planAccept,
  planBlock,
  planCancel,
  planDecline,
  planEnd,
  planInvite,
  planMessage,
  planUnblock,
  type Plan,
} from './whisperPlans'
import { pickSlot, type SlotDoc } from './whisperSlots'
import { whisperPhase } from './whisperTime'
import { EXPIRES_HINT_MS, type WhisperView } from './whisperTypes'
import { isOnline, reasonOf, WRITE_TIMEOUT_MS, withTimeout, type WriteResult } from './whisperWrite'

/*
 * The Firebase side of whispers. The decisions (which slot, which error, what to write) are in the
 * pure modules and are tested there. Everything here is bounded: offline writes nothing, and
 * every read and write gives up after WRITE_TIMEOUT_MS, so no button spins forever.
 * Raw error codes go to the console only; the screen gets a WhisperErrorCode.
 */

export type ActionResult = { ok: true } | { ok: false; code: WhisperErrorCode }

const GENERIC: ActionResult = { ok: false, code: 'generic' }

/** One bounded, guarded write. */
export function commit(plan: Plan): Promise<WriteResult> {
  return commitPlan(db, plan)
}

function logFailure(action: string, result: WriteResult): void {
  if (!result.ok) console.warn(`Whisper ${action} failed:`, result.reason)
}

/** The person's own slot documents, or null when they could not be read in time. */
export async function loadMySlots(uid: string): Promise<SlotDoc[] | null> {
  if (!isOnline()) return null
  try {
    const snap = await withTimeout(
      getDocs(query(collection(db, 'whisperSlots'), where('userId', '==', uid))),
      WRITE_TIMEOUT_MS,
    )
    const slots: SlotDoc[] = []
    for (const d of snap.docs) {
      const n = Number(d.id.slice(uid.length + 1))
      const whisperId = d.data().whisperId
      if ((n === 1 || n === 2 || n === 3) && typeof whisperId === 'string') slots.push({ n, whisperId })
    }
    return slots
  } catch (err) {
    console.warn('Whisper slots could not be read:', reasonOf(err))
    return null
  }
}

/**
 * One whisper by id, or null when it is missing, unreadable or the read timed out.
 * Under these rules a read of a missing document is a permission-denied, so both look the same.
 */
export async function readWhisper(id: string): Promise<WhisperView | null> {
  if (!isOnline()) return null
  try {
    const snap = await withTimeout(getDoc(doc(db, 'whispers', id)), WRITE_TIMEOUT_MS)
    return snap.exists() ? toWhisperView(snap.id, snap.data({ serverTimestamps: 'estimate' })) : null
  } catch (err) {
    if (reasonOf(err) !== 'permission-denied') console.warn('Whisper could not be read:', reasonOf(err))
    return null
  }
}

/** Has this person blocked that one? null when it could not be checked. */
export async function hasBlocked(uid: string, otherId: string): Promise<boolean | null> {
  if (!isOnline()) return null
  try {
    return (await withTimeout(getDoc(doc(db, 'users', uid, 'blocked', otherId)), WRITE_TIMEOUT_MS)).exists()
  } catch (err) {
    console.warn('Block entry could not be read:', reasonOf(err))
    return null
  }
}

/**
 * Invite someone. `whispers` is the person's loaded list (for the slot pick). `whisperId` is made once
 * per sheet and reused on retry. If anything fails, the whisper is read back before an error is shown,
 * because the first attempt may have gone through.
 */
export async function sendInvite(i: {
  uid: string
  inviteeId: string
  whisperId: string
  whispers: WhisperView[]
}): Promise<ActionResult> {
  const slots = await loadMySlots(i.uid)
  if (!slots) return GENERIC
  const slot = pickSlot(slots, i.whispers, Date.now())
  if (slot === null) return { ok: false, code: 'too_many' }
  const expiresAt = Timestamp.fromMillis(Date.now() + EXPIRES_HINT_MS)
  const result = await commit(planInvite({ uid: i.uid, inviteeId: i.inviteeId, whisperId: i.whisperId, slot, expiresAt }))
  if (result.ok) return { ok: true }
  logFailure('invite', result)
  return classifyInviteFailure(await readWhisper(i.whisperId), i.uid) === 'sent' ? { ok: true } : GENERIC
}

/** Accept a pending invite. Checks the window on the device clock first, then picks a slot. */
export async function acceptInvite(i: { uid: string; whisper: WhisperView; whispers: WhisperView[] }): Promise<ActionResult> {
  const phase = whisperPhase(i.whisper, Date.now())
  if (phase === 'open') return { ok: true } // already accepted
  if (phase !== 'invite_open') return { ok: false, code: 'invite_expired' }
  const slots = await loadMySlots(i.uid)
  if (!slots) return GENERIC
  const slot = pickSlot(slots, i.whispers, Date.now())
  if (slot === null) return { ok: false, code: 'too_many' }
  const result = await commit(planAccept({ uid: i.uid, whisper: i.whisper, slot }))
  if (result.ok) return { ok: true }
  logFailure('accept', result)
  const verdict = classifyAcceptFailure(await readWhisper(i.whisper.id), i.uid, Date.now())
  if (verdict === 'accepted') return { ok: true }
  return verdict === 'invite_expired' ? { ok: false, code: 'invite_expired' } : GENERIC
}

async function run(action: string, plan: Plan): Promise<ActionResult> {
  const result = await commit(plan)
  if (result.ok) return { ok: true }
  logFailure(action, result)
  return GENERIC
}

/** The invitee declines. Writes nothing when the rules would not allow it for this person and status. */
export function declineInvite(i: { uid: string; whisper: WhisperView }): Promise<ActionResult> {
  if (endActionFor(i.whisper, i.uid) !== 'decline') return Promise.resolve(GENERIC)
  return run('decline', planDecline(i.whisper.id))
}

/** The inviter cancels a pending invite. */
export function cancelInvite(i: { uid: string; whisper: WhisperView }): Promise<ActionResult> {
  if (endActionFor(i.whisper, i.uid) !== 'cancel') return Promise.resolve(GENERIC)
  return run('cancel', planCancel({ uid: i.uid, whisperId: i.whisper.id }))
}

/** Either member ends an accepted thread. */
export function endWhisper(i: { uid: string; whisper: WhisperView }): Promise<ActionResult> {
  if (endActionFor(i.whisper, i.uid) !== 'end') return Promise.resolve(GENERIC)
  return run('end', planEnd({ uid: i.uid, whisperId: i.whisper.id }))
}

/** Block a person, and end (or decline, or cancel) the whisper in the same batch when that is allowed. */
export function blockPerson(i: { uid: string; otherId: string; whisper: WhisperView | null }): Promise<ActionResult> {
  return run('block', planBlock(i))
}

export function unblockPerson(i: { uid: string; otherId: string }): Promise<ActionResult> {
  return run('unblock', planUnblock(i))
}

/**
 * Send one message. Same result shape as the room sender, so the composer can use it unchanged.
 * A denial is read back first: a retry of a message that already went through looks like a denial.
 */
export async function sendWhisperMessage(i: {
  uid: string
  whisper: WhisperView
  messageId: string
  body: string
  recheck: () => SendErrorCode | null
}): Promise<SendResult> {
  const early = i.recheck()
  if (early) return { status: 'failed', code: early }
  const result = await commit(planMessage({ uid: i.uid, whisper: i.whisper, messageId: i.messageId, body: i.body }))
  if (result.ok) return { status: 'sent' }
  logFailure('message', result)
  if (result.reason !== 'permission-denied') return { status: 'failed', code: 'offline' }
  const outcome = await resolveDenied({
    uid: i.uid,
    readMessage: async () => {
      const snap = await withTimeout(getDoc(doc(db, 'whispers', i.whisper.id, 'messages', i.messageId)), WRITE_TIMEOUT_MS)
      return snap.exists() ? (snap.data() as { senderId?: string }) : null
    },
    recheck: i.recheck(),
  })
  return outcome === 'already_sent' ? { status: 'already_sent' } : { status: 'failed', code: outcome }
}
