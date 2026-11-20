import { doc, getDoc, increment, serverTimestamp, writeBatch, type Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { preCheckSend, resolveDenied, type SendErrorCode } from './messageUtils'

export interface SendInput {
  roomId: string
  uid: string
  /** A UUID made once per message. Retrying with the same id can never create a duplicate. */
  messageId: string
  body: string
  /** Copied from the room document unchanged: the rules require an exact match. */
  roomExpiresAt: Timestamp
  openedAtMs: number
  createdAtMs: number
  lastSentAtMs: number | null
}

export type SendResult = { status: 'sent' | 'already_sent' } | { status: 'failed'; code: SendErrorCode }

/**
 * First message in a room: four writes in one batch (participant, room count +1, message,
 * rate-limit record). Later messages: two writes (message, rate-limit record).
 */
export async function sendMessage(i: SendInput): Promise<SendResult> {
  const body = i.body.trim()
  const recheck = () =>
    preCheckSend({ body, nowMs: Date.now(), openedAtMs: i.openedAtMs, lastSentAtMs: i.lastSentAtMs, createdAtMs: i.createdAtMs })

  const early = recheck()
  if (early) return { status: 'failed', code: early }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'failed', code: 'offline' }

  const roomRef = doc(db, 'rooms', i.roomId)
  const participantRef = doc(db, 'rooms', i.roomId, 'participants', i.uid)
  const messageRef = doc(db, 'rooms', i.roomId, 'messages', i.messageId)
  const rateRef = doc(db, 'rooms', i.roomId, 'rateLimits', i.uid)

  try {
    const alreadyPosted = (await getDoc(participantRef)).exists()
    const batch = writeBatch(db)
    if (!alreadyPosted) {
      batch.set(participantRef, {
        userId: i.uid,
        firstMessageId: i.messageId,
        firstMessageAt: serverTimestamp(),
        expiresAt: i.roomExpiresAt,
      })
      batch.update(roomRef, { postingParticipantCount: increment(1) })
    }
    batch.set(messageRef, {
      messageId: i.messageId,
      senderId: i.uid,
      body,
      sentAt: serverTimestamp(),
      roomId: i.roomId,
      expiresAt: i.roomExpiresAt,
    })
    batch.set(rateRef, { userId: i.uid, lastMessageAt: serverTimestamp(), expiresAt: i.roomExpiresAt })
    await batch.commit()
    return { status: 'sent' }
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'permission-denied') {
      const outcome = await resolveDenied({
        uid: i.uid,
        readMessage: async () => {
          const snap = await getDoc(messageRef)
          return snap.exists() ? (snap.data() as { senderId?: string }) : null
        },
        recheck: recheck(),
      })
      return outcome === 'already_sent' ? { status: 'already_sent' } : { status: 'failed', code: outcome }
    }
    console.error('sendMessage failed', err)
    return { status: 'failed', code: 'offline' }
  }
}
