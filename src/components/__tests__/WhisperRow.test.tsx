import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MIN, NOW, openWhisper, whisperView } from '../../lib/__tests__/whisperFixtures'
import { GENERIC_ERROR_TEXT } from '../../lib/whisperCopy'
import { WhisperRowView, type WhisperRowViewProps } from '../WhisperRow'

vi.mock('../../lib/firebase', () => ({ db: {}, auth: {} }))

const open = (over: Partial<WhisperRowViewProps> = {}): WhisperRowViewProps => ({
  whisper: openWhisper(10, { id: 'wopen', inviterId: 'me', inviteeId: 'them' }),
  variant: 'open',
  otherId: 'them',
  profile: { username: 'kai_9', avatarSeed: 'k' },
  nowMs: NOW,
  busy: null,
  error: null,
  finished: false,
  onCancel: () => {},
  ...over,
})
const waiting = (over: Partial<WhisperRowViewProps> = {}): WhisperRowViewProps =>
  open({
    whisper: whisperView({ id: 'wwait', inviterId: 'me', inviteeId: 'them', createdAtMs: NOW - 2 * MIN }),
    variant: 'waiting',
    ...over,
  })

describe('WhisperRowView, open', () => {
  it('links to the whisper and shows the other person and the time left', () => {
    const html = renderToStaticMarkup(<WhisperRowView {...open()} />)
    expect(html).toContain('href="#whisper/wopen"')
    expect(html).toContain('kai_9')
    expect(html).toContain('50 min left')
  })
  it('has no Cancel button', () => {
    expect(renderToStaticMarkup(<WhisperRowView {...open()} />)).not.toContain('<button')
  })
  it('the link has a 44px touch target', () => {
    expect(renderToStaticMarkup(<WhisperRowView {...open()} />)).toContain('min-h-[44px]')
  })
})

describe('WhisperRowView, waiting', () => {
  it('says who it is waiting for, shows the time left, links to the whisper, and can be cancelled', () => {
    const html = renderToStaticMarkup(<WhisperRowView {...waiting()} />)
    expect(html).toContain('Waiting for kai_9 to reply.')
    expect(html).toContain('13 min left')
    expect(html).toContain('href="#whisper/wwait"')
    expect(html).toContain('>Cancel invite<')
    expect(html.match(/min-h-\[44px\]/g)!.length).toBeGreaterThanOrEqual(2)
  })
  it('while cancelling, the button is off and says so', () => {
    const html = renderToStaticMarkup(<WhisperRowView {...waiting({ busy: 'cancel' })} />)
    expect(html).toContain('disabled=""')
    expect(html).toContain('Working...')
  })
  it('after a success the button stays off', () => {
    expect(renderToStaticMarkup(<WhisperRowView {...waiting({ finished: true })} />)).toContain('disabled=""')
  })
  it('shows an error as an alert', () => {
    const html = renderToStaticMarkup(<WhisperRowView {...waiting({ error: GENERIC_ERROR_TEXT })} />)
    expect(html).toContain('role="alert"')
  })
  it('shows "..." while the profile loads', () => {
    expect(renderToStaticMarkup(<WhisperRowView {...waiting({ profile: undefined })} />)).toContain('Waiting for ... to reply.')
  })
})
