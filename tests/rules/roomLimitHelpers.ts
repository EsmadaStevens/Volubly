import {
  doc,
  setDoc,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore'
import type { Firestore, WriteBatch } from 'firebase/firestore'

const HOUR_MS = 60 * 60 * 1000

export interface BatchOptions {
  uid: string                               // 'userA' or 'userB'
  roomId: string
  slotId: string                            // e.g. 'userA_1'
  roomOverrides?: Record<string, unknown>   // merged over the valid room data
  slotOverrides?: Record<string, unknown>   // merged over the valid slot data
  omitSlot?: boolean                        // room only, no slot write
  omitRoom?: boolean                        // slot only, no room write
}

/**
 * Build the writeBatch: room (openedAt serverTimestamp, expiresAt now + 25h)
 * plus slot. Returns the batch; the caller runs assertSucceeds(batch.commit())
 * or assertFails(batch.commit()).
 */
export function createRoomBatch(db: Firestore, opts: BatchOptions): WriteBatch {
  const expiresAt = Timestamp.fromMillis(Date.now() + 25 * HOUR_MS)

  const roomData: Record<string, unknown> = {
    type: 'open_topic',
    title: 'Test room',
    maturityLabel: 'all_ages',
    categories: ['other'],
    openedAt: serverTimestamp(),
    expiresAt,
    createdBy: opts.uid,
    postingParticipantCount: 0,
    ...opts.roomOverrides,
  }

  const slotData: Record<string, unknown> = {
    userId: opts.uid,
    roomId: opts.roomId,
    openedAt: serverTimestamp(),
    expiresAt,
    ...opts.slotOverrides,
  }

  // An override value of undefined removes that key (the SDK rejects undefined values).
  for (const data of [roomData, slotData]) {
    for (const key of Object.keys(data)) {
      if (data[key] === undefined) delete data[key]
    }
  }

  const batch = writeBatch(db)
  if (!opts.omitRoom) {
    batch.set(doc(db, 'rooms', opts.roomId), roomData)
  }
  if (!opts.omitSlot) {
    batch.set(doc(db, 'roomSlots', opts.slotId), slotData)
  }
  return batch
}

/**
 * Seed roomSlots/{uid}_{n} through the admin context with a backdated openedAt.
 * expiresAt is openedAt + 25h.
 */
export async function seedSlot(
  admin: Firestore,
  uid: string,
  n: 1 | 2,
  opts: { roomId?: string; ageSeconds: number },
): Promise<void> {
  const openedMs = Date.now() - opts.ageSeconds * 1000
  await setDoc(doc(admin, 'roomSlots', `${uid}_${n}`), {
    userId: uid,
    roomId: opts.roomId ?? `seed-room-${uid}-${n}`,
    openedAt: Timestamp.fromMillis(openedMs),
    expiresAt: Timestamp.fromMillis(openedMs + 25 * HOUR_MS),
  })
}

/** Seed users/{uid} (18_plus, created 2 days ago so not in probation). */
export async function seedUser(admin: Firestore, uid: string): Promise<void> {
  await setDoc(doc(admin, 'users', uid), {
    createdAt: Timestamp.fromMillis(Date.now() - 48 * HOUR_MS),
    ageBandLabel: '18_plus',
  })
}
