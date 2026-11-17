import { CATEGORY_ALLOWLIST, MATURITY_LABELS, ROOM_TYPES, type Category, type MaturityLabel, type RoomType, type RoomView } from '../types'

/** Turns a Firestore room document into a RoomView. Returns null if it is malformed. */
export function toRoomView(id: string, data: Record<string, unknown>): RoomView | null {
  const openedAt = data.openedAt as { toMillis?: () => number } | null | undefined
  if (!openedAt || typeof openedAt.toMillis !== 'function') return null
  if (typeof data.title !== 'string') return null
  if (!(ROOM_TYPES as readonly unknown[]).includes(data.type)) return null
  if (!(MATURITY_LABELS as readonly unknown[]).includes(data.maturityLabel)) return null
  const categories = Array.isArray(data.categories)
    ? data.categories.filter((c): c is Category => (CATEGORY_ALLOWLIST as readonly unknown[]).includes(c))
    : []
  return {
    id,
    type: data.type as RoomType,
    title: data.title,
    maturityLabel: data.maturityLabel as MaturityLabel,
    categories,
    openedAtMs: openedAt.toMillis(),
    postingParticipantCount: typeof data.postingParticipantCount === 'number' ? data.postingParticipantCount : 0,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
  }
}
