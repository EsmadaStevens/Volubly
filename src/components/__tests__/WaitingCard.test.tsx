import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MIN, NOW, whisperView } from '../../lib/__tests__/whisperFixtures'
import { GENERIC_ERROR_TEXT } from '../../lib/whisperCopy'
import { WaitingCardView, type WaitingCardViewProps } from '../WaitingCard'

vi.mock('../../lib/firebase', () => ({ db: {}, auth: {} }))

const base = (over: Partial<WaitingCardViewProps> = {}): WaitingCardViewProps => ({
  whisper: whisperView({ inviterId: 'me', inviteeId: 'them', createdAtMs: NOW - 2 * MIN }),
  otherId: 'them',
  profile: { username: 'kai_9', avatarSeed: 'k' },
  nowMs: NOW,
  busy: null,
  error: null,
  finished: false,
  onCancel: () => {},
  ...over,
})

describe('WaitingCardView', () => {
  it('says who it is waiting for, the time left, and offers Cancel invite with a 44px target', () => {
    const html = renderToStaticMarkup(<WaitingCardView {...base()} />)
    expect(html).toContain('Waiting for kai_9 to reply.')
    expect(html).toContain('13 min left')
    expect(html).toContain('>Cancel invite<')
    expect(html).toContain('min-h-[44px]')
  })
  it('while cancelling the button is off and says so; after success it stays off', () => {
    expect(renderToStaticMarkup(<WaitingCardView {...base({ busy: 'cancel' })} />)).toContain('Working...')
    expect(renderToStaticMarkup(<WaitingCardView {...base({ finished: true })} />)).toContain('disabled=""')
  })
  it('shows an error as an alert', () => {
    expect(renderToStaticMarkup(<WaitingCardView {...base({ error: GENERIC_ERROR_TEXT })} />)).toContain('role="alert"')
  })
})
