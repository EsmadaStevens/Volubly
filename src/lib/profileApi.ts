import { doc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { PublicProfile } from '../types'

/** Updates publicProfiles/{uid}. The rules allow only the owner, and only these two fields. */
export async function saveProfile(uid: string, profile: PublicProfile): Promise<void> {
  await updateDoc(doc(db, 'publicProfiles', uid), { username: profile.username, avatarSeed: profile.avatarSeed })
}
