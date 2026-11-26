import { isExpired } from './roomUtils'
import type { RoomView } from '../types'

/** Other rooms still open, busiest first (ties: newest), for the wide-screen side list. */
export function otherOpenRooms(rooms: RoomView[], currentId: string, nowMs: number, limit = 8): RoomView[] {
  return rooms
    .filter((r) => r.id !== currentId && !isExpired(r.openedAtMs, nowMs))
    .sort((a, b) => b.postingParticipantCount - a.postingParticipantCount || b.openedAtMs - a.openedAtMs)
    .slice(0, limit)
}
