import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { INBOX_ERROR } from '../lib/whisperCopy'
import type { WhisperView } from '../lib/whisperTypes'
import { toSubError, whisperListFrom } from '../lib/whisperWatch'
import { useSubscription, type Open } from './useSubscription'

/**
 * Every whisper the person is in, in no particular order (sorting happens on the client, because a
 * query with an order would need a composite index). Opens nothing when `uid` is null, which is how
 * an account that may not use whispers avoids any whisper read.
 */
export function useWhispers(uid: string | null) {
  const open: Open<WhisperView[]> | null = uid
    ? (emit) =>
        onSnapshot(
          query(collection(db, 'whispers'), where('memberIds', 'array-contains', uid)),
          (snap) =>
            emit({
              status: 'ready',
              data: whisperListFrom(snap.docs.map((d) => ({ id: d.id, data: d.data({ serverTimestamps: 'estimate' }) }))),
            }),
          (err) => {
            console.warn('Whisper list error:', (err as { code?: string }).code)
            emit(toSubError(err, INBOX_ERROR))
          },
        )
    : null
  return useSubscription(open, ['whispers', uid])
}
