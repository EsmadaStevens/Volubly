import { useCallback, useEffect, useState } from 'react'
import { onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { buildDiscoveryQuery } from '../lib/discoveryQuery'
import { discoveryPlan } from '../lib/discoveryUtils'
import { toRoomView } from '../lib/roomData'
import type { AgeBandLabel, RoomView, SortOrder } from '../types'

export type RoomsState =
  | { status: 'loading' }
  | { status: 'ready'; rooms: RoomView[] }
  | { status: 'error'; message: string }

export function useRooms(ageBand: AgeBandLabel, order: SortOrder) {
  const [state, setState] = useState<RoomsState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  // "newest" and "busiest" share one query (busiest is sorted on the client).
  const queryOrder: SortOrder = order === 'ending_soon' ? 'ending_soon' : 'newest'

  useEffect(() => {
    setState({ status: 'loading' })
    const q = buildDiscoveryQuery(db, discoveryPlan(ageBand, queryOrder, Date.now()))
    return onSnapshot(
      q,
      (snap) => {
        const rooms = snap.docs
          .map((d) => toRoomView(d.id, d.data({ serverTimestamps: 'estimate' })))
          .filter((r): r is RoomView => r !== null)
        setState({ status: 'ready', rooms })
      },
      (err) => {
        console.error('Room list error', err)
        const message =
          err.code === 'failed-precondition'
            ? 'The room list is still being set up. Try again in a few minutes.'
            : "We couldn't load the rooms. Check your connection and try again."
        setState({ status: 'error', message })
      },
    )
  }, [ageBand, queryOrder, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { state, retry }
}
