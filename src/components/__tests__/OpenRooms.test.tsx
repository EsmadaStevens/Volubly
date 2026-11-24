import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import OpenRoomsList from '../OpenRoomsList'
import { otherOpenRooms } from '../../lib/openRooms'
import { HOUR_MS } from '../../lib/roomUtils'
import type { RoomView } from '../../types'

const NOW = 1_800_000_000_000
const room = (id: string, over: Partial<RoomView> = {}): RoomView => ({
  id, type: 'public', title: `Room ${id}`, maturityLabel: 'all_ages', categories: [], openedAtMs: NOW - HOUR_MS, postingParticipantCount: 0, createdBy: 'x', ...over,
}) as RoomView

describe('otherOpenRooms', () => {
  it('leaves out this room and ended rooms, busiest first, capped', () => {
    const rooms = [
      room('a', { postingParticipantCount: 1 }),
      room('b', { postingParticipantCount: 5 }),
      room('this', { postingParticipantCount: 9 }),
      room('old', { openedAtMs: NOW - 25 * HOUR_MS, postingParticipantCount: 50 }),
      room('c', { postingParticipantCount: 1, openedAtMs: NOW - 10 }),
    ]
    expect(otherOpenRooms(rooms, 'this', NOW).map((r) => r.id)).toEqual(['b', 'c', 'a'])
    expect(otherOpenRooms(rooms, 'this', NOW, 2)).toHaveLength(2)
  })
})

describe('OpenRoomsList', () => {
  it('links each room by hash and shows who has posted and time left', () => {
    const html = renderToStaticMarkup(<OpenRoomsList rooms={[room('a', { postingParticipantCount: 3 })]} nowMs={NOW} />)
    expect(html).toContain('href="#room/a"')
    expect(html).toContain('Room a')
    expect(html).toContain('3 posted')
  })
  it('says so when nothing else is open', () => {
    expect(renderToStaticMarkup(<OpenRoomsList rooms={[]} nowMs={NOW} />)).toContain('No other rooms are open')
  })
})
