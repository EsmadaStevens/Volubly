import { useEffect, useState } from 'react'
import { doc, onSnapshot, type Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { toRoomView } from '../lib/roomData'
import type { RoomView } from '../types'

export type RoomState =
  | { status: 'loading' }
  | { status: 'ready'; room: RoomView; expiresAt: Timestamp }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

export function useRoom(roomId: string): RoomState {
  const [state, setState] = useState<RoomState>({ status: 'loading' })

  useEffect(() => {
    setState({ status: 'loading' })
    return onSnapshot(
      doc(db, 'rooms', roomId),
      (snap) => {
        if (!snap.exists()) return setState({ status: 'unavailable' })
        const data = snap.data({ serverTimestamps: 'estimate' })
        const room = toRoomView(snap.id, data)
        if (!room || !data.expiresAt) return setState({ status: 'unavailable' })
        setState({ status: 'ready', room, expiresAt: data.expiresAt as Timestamp })
      },
      (err) => {
        // A closed room, or one this account's age group cannot see, is refused by the rules.
        if (err.code === 'permission-denied') return setState({ status: 'unavailable' })
        console.error('Room error', err)
        setState({ status: 'error', message: "We couldn't open this room. Check your connection and try again." })
      },
    )
  }, [roomId])

  return state
}
