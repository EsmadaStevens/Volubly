import { collection, doc, getDoc, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { RoomLimitError, slotId, slotsToTry, type SlotInfo } from './roomSlots'
import { ROOM_TTL_MS, type Category, type MaturityLabel, type RoomType } from '../types'

export interface NewRoom {
  uid: string
  type: RoomType
  title: string
  maturityLabel: MaturityLabel
  categories: Category[]
}

async function readSlot(uid: string, n: 1 | 2): Promise<SlotInfo> {
  try {
    const snap = await getDoc(doc(db, 'roomSlots', slotId(uid, n)))
    const opened = snap.exists() ? (snap.data().openedAt as { toMillis?: () => number } | undefined) : undefined
    return { n, openedAtMs: opened && typeof opened.toMillis === 'function' ? opened.toMillis() : null }
  } catch {
    // Unreadable counts as free; the rules still decide when we try to write.
    return { n, openedAtMs: null }
  }
}

/**
 * Creates a room together with one of the person's two room slots, in a single batch.
 * The rules insist on both: no slot, no room. If both slots are in use the person is
 * at the limit (RoomLimitError).
 *
 * openedAt is the server time. expiresAt is only a cleanup hint for TTL deletion; the rules
 * need it 24 to 26 hours after server time, so we aim for 25.
 */
export async function createRoom(input: NewRoom): Promise<string> {
  const slots = await Promise.all([readSlot(input.uid, 1), readSlot(input.uid, 2)])
  const order = slotsToTry(slots, Date.now())
  if (order.length === 0) throw new RoomLimitError()

  const roomRef = doc(collection(db, 'rooms'))
  const expiresAt = Timestamp.fromMillis(Date.now() + ROOM_TTL_MS)

  for (const n of order) {
    const batch = writeBatch(db)
    batch.set(roomRef, {
      type: input.type,
      title: input.title,
      maturityLabel: input.maturityLabel,
      categories: input.categories,
      openedAt: serverTimestamp(),
      expiresAt,
      createdBy: input.uid,
      postingParticipantCount: 0,
    })
    batch.set(doc(db, 'roomSlots', slotId(input.uid, n)), {
      userId: input.uid,
      roomId: roomRef.id,
      openedAt: serverTimestamp(),
      expiresAt,
    })
    try {
      await batch.commit()
      return roomRef.id
    } catch (err) {
      if ((err as { code?: string }).code !== 'permission-denied') throw err
      // That slot was taken (or this device's clock was off). Try the other one.
    }
  }
  throw new RoomLimitError()
}
