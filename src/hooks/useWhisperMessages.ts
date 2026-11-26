import { collection, limitToLast, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { MESSAGES_LOAD_ERROR } from '../lib/whisperCopy'
import { messagesFrom, messagesStateFrom, toSubError } from '../lib/whisperWatch'
import type { MessageView } from '../types'
import type { MessagesState } from './useMessages'
import { useSubscription, type Open } from './useSubscription'

/**
 * One whisper's messages, newest 200, oldest first. The listener exists only while `enabled` is true,
 * which the chat sets only in the open phase. Disabled gives the `closed` state and holds no messages.
 * A refusal (the thread closed, or this device's clock is behind the server) also gives `closed`.
 * The query has one order on one field, so it needs no new index.
 */
export function useWhisperMessages(id: string | null, enabled: boolean): MessagesState {
  const open: Open<MessageView[]> | null =
    id && enabled
      ? (emit) =>
          onSnapshot(
            query(collection(db, 'whispers', id, 'messages'), orderBy('sentAt', 'asc'), limitToLast(200)),
            (snap) =>
              emit({
                status: 'ready',
                data: messagesFrom(
                  snap.docs.map((d) => ({
                    id: d.id,
                    data: d.data({ serverTimestamps: 'estimate' }),
                    pending: d.metadata.hasPendingWrites,
                  })),
                ),
              }),
            (err) => {
              console.warn('Whisper messages error:', (err as { code?: string }).code)
              emit(toSubError(err, MESSAGES_LOAD_ERROR))
            },
          )
      : null
  const { state } = useSubscription(open, ['whisper-messages', id, enabled])
  return messagesStateFrom(state)
}
