export const ROOM_TITLE_MIN = 3
export const ROOM_TITLE_MAX = 60

export type TitleCheck = { ok: true; value: string } | { ok: false; reason: string }

export function checkRoomTitle(raw: string): TitleCheck {
  const value = raw.replace(/\s+/g, ' ').trim()
  if (value.length < ROOM_TITLE_MIN) return { ok: false, reason: `Give the room a title of at least ${ROOM_TITLE_MIN} characters.` }
  if (value.length > ROOM_TITLE_MAX) return { ok: false, reason: `Keep the title to ${ROOM_TITLE_MAX} characters or fewer.` }
  return { ok: true, value }
}
