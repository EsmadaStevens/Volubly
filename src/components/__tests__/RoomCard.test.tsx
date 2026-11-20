import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import RoomCard from '../RoomCard'
import type { RoomView } from '../../types'

const room: RoomView = {
  id: 'abc',
  type: 'live_room',
  title: 'Cup final, live',
  maturityLabel: '13_plus',
  categories: ['sport', 'music', 'tech'],
  openedAtMs: Date.now() - 2 * 3_600_000,
  postingParticipantCount: 12,
  createdBy: 'u',
}

describe('RoomCard', () => {
  it('shows title, count, countdown, labels and a join button', () => {
    const html = renderToString(<RoomCard room={room} picks={['sport']} onOpen={() => {}} />)
    expect(html).toContain('Cup final, live')
    expect(html).toContain('12 have posted')
    expect(html).toContain('In your Sport picks')
    expect(html).toContain('left')
    expect(html).toContain('13+')
    expect(html).toContain('Join room')
    expect(html).not.toContain('Tech') // only the first two categories are shown
  })
  it('invites the first poster into an empty room', () => {
    const html = renderToString(<RoomCard room={{ ...room, postingParticipantCount: 0 }} picks={[]} onOpen={() => {}} />)
    expect(html).toContain('Be the first')
  })
})
