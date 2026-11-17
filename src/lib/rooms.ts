import { collection, doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { ROOM_TTL_MS, type Category, type MaturityLabel, type RoomType } from '../types'

export interface NewRoom {
  uid: string
  type: RoomType
  title: string
  maturityLabel: MaturityLabel
  categories: Category[]
}

/**
 * Creates a room. openedAt is the server time (the rules insist). expiresAt is only a
 * cleanup hint for TTL deletion: the rules require it to be 24 to 26 hours after the server
 * time, so we aim for the middle, 25 hours, to leave room for clock and network differences.
 */
export async function createRoom(input: NewRoom): Promise<string> {
  const ref = doc(collection(db, 'rooms'))
  await setDoc(ref, {
    type: input.type,
    title: input.title,
    maturityLabel: input.maturityLabel,
    categories: input.categories,
    openedAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + ROOM_TTL_MS),
    createdBy: input.uid,
    postingParticipantCount: 0,
  })
  return ref.id
}
