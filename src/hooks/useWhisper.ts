import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { WHISPER_LOAD_ERROR } from '../lib/whisperCopy'
import type { WhisperView } from '../lib/whisperTypes'
import { toSubError, whisperFrom } from '../lib/whisperWatch'
import { useSubscription, type Open } from './useSubscription'

/**
 * One whisper document. A missing document and a refused read both give `denied`, which the screen
 * shows as "not available". Opens nothing when `id` is null.
 */
export function useWhisper(id: string | null) {
  const open: Open<WhisperView> | null = id
    ? (emit) =>
        onSnapshot(
          doc(db, 'whispers', id),
          (snap) => emit(whisperFrom({ id: snap.id, exists: snap.exists(), data: snap.data({ serverTimestamps: 'estimate' }) })),
          (err) => {
            console.warn('Whisper error:', (err as { code?: string }).code)
            emit(toSubError(err, WHISPER_LOAD_ERROR))
          },
        )
    : null
  return useSubscription(open, ['whisper', id])
}
