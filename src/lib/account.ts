import { doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import type { AgeBandLabel } from '../types'

export interface NewAccount {
  uid: string
  username: string
  avatarSeed: string
  ageBand: AgeBandLabel
}

/**
 * Creates users/{uid} (private: createdAt + age band) and publicProfiles/{uid}
 * (username + avatar seed) in one atomic batch. createdAt must be the server time:
 * the rules reject anything else, and probation is measured from it.
 */
export async function createAccount({ uid, username, avatarSeed, ageBand }: NewAccount): Promise<void> {
  const batch = writeBatch(db)
  batch.set(doc(db, 'users', uid), { createdAt: serverTimestamp(), ageBandLabel: ageBand })
  batch.set(doc(db, 'publicProfiles', uid), { username, avatarSeed })
  await batch.commit()
}
