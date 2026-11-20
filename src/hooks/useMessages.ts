import { useEffect, useState } from 'react'
import { collection, limitToLast, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { toMessageView } from '../lib/messageData'
import type { MessageView } from '../types'

export type MessagesState =
  | { status: 'loading' }
  | { status: 'ready'; messages: MessageView[] }
  | { status: 'closed' }
  | { status: 'error'; message: string }

export function useMessages(roomId: string): MessagesState {
  const [state, setState] = useState<MessagesState>({ status: 'loading' })

  useEffect(() => {
    setState({ status: 'loading' })
    const q = query(collection(db, 'rooms', roomId, 'messages'), orderBy('sentAt', 'asc'), limitToLast(200))
    return onSnapshot(
      q,
      (snap) => {
        const messages = snap.docs
          .map((d) => toMessageView(d.id, d.data({ serverTimestamps: 'estimate' }), d.metadata.hasPendingWrites))
          .filter((m): m is MessageView => m !== null)
        setState({ status: 'ready', messages })
      },
      (err) => {
        if (err.code === 'permission-denied') return setState({ status: 'closed' })
        console.error('Messages error', err)
        setState({ status: 'error', message: "We couldn't load the messages. Check your connection." })
      },
    )
  }, [roomId])

  return state
}
