import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadySession } from '../../components/AuthGate'
import { MIN, NOW, openWhisper, whisperView } from '../../lib/__tests__/whisperFixtures'
import { INBOX_EMPTY, INBOX_ERROR } from '../../lib/whisperCopy'
import { buildInbox } from '../../lib/whisperInbox'
import type { WhisperView } from '../../lib/whisperTypes'
import type { PublicProfile } from '../../types'
import WhispersPage, { WhispersView, type InboxActions, type WhispersViewProps } from '../WhispersPage'

const mocks = vi.hoisted(() => ({ useWhispers: vi.fn(), useProfiles: vi.fn() }))
vi.mock('../../hooks/useWhispers', () => ({ useWhispers: mocks.useWhispers }))
vi.mock('../../hooks/useProfiles', () => ({ useProfiles: mocks.useProfiles }))
vi.mock('../../lib/firebase', () => ({ db: {}, auth: {} }))

const actions: InboxActions = {
  accept: async () => ({ ok: true }),
  decline: async () => ({ ok: true }),
  declineBlock: async () => ({ ok: true }),
  cancel: async () => ({ ok: true }),
}
const profiles = new Map<string, PublicProfile | null>([
  ['them', { username: 'kai_9', avatarSeed: 'k' }],
  ['other', { username: 'ola_3', avatarSeed: 'o' }],
])

function props(list: WhisperView[], over: Partial<WhispersViewProps> = {}): WhispersViewProps {
  return {
    status: 'ready',
    inbox: buildInbox(list, 'me', NOW),
    uid: 'me',
    profiles,
    nowMs: NOW,
    actions,
    onRetry: () => {},
    onAccepted: () => {},
    ...over,
  }
}

const session = (band: ReadySession['ageBand']): ReadySession => ({
  uid: 'me',
  profile: { username: 'me_1', avatarSeed: 'm' },
  ageBand: band,
  createdAtMs: NOW - 100 * MIN,
  setProfile: () => {},
})

beforeEach(() => {
  mocks.useWhispers.mockReset()
  mocks.useProfiles.mockReset()
  mocks.useWhispers.mockReturnValue({ state: { status: 'loading' }, retry: () => {} })
  mocks.useProfiles.mockReturnValue(profiles)
})

describe('WhispersView states', () => {
  it('loading', () => {
    const html = renderToStaticMarkup(<WhispersView {...props([], { status: 'loading' })} />)
    expect(html).toContain('Loading whispers...')
    expect(html).toContain('role="status"')
    expect(html).not.toContain(INBOX_EMPTY)
  })

  it('error: a plain message as an alert, and a Try again button with a 44px target', () => {
    const html = renderToStaticMarkup(<WhispersView {...props([], { status: 'error', errorMessage: INBOX_ERROR })} />)
    expect(html).toContain('role="alert"')
    expect(html.replace(/&#x27;/g, "'")).toContain(INBOX_ERROR)
    expect(html).toContain('>Try again<')
    expect(html).toContain('min-h-[44px]')
  })

  it('empty: a calm sentence and no sections', () => {
    const html = renderToStaticMarkup(<WhispersView {...props([])} />)
    expect(html).toContain(INBOX_EMPTY)
    expect(html).not.toContain('Invites for you')
    expect(html).not.toContain('Open whispers')
    expect(html).not.toContain('Waiting for a reply')
  })

  it('has a way back and a title', () => {
    const html = renderToStaticMarkup(<WhispersView {...props([])} />)
    expect(html).toContain('href="#"')
    expect(html).toContain('Back to rooms')
    expect(html).toContain('<h1')
  })
})

describe('WhispersView sections', () => {
  const list = [
    whisperView({ id: 'inv1', inviterId: 'them', inviteeId: 'me', createdAtMs: NOW - 2 * MIN }),
    openWhisper(10, { id: 'open1', inviterId: 'me', inviteeId: 'other' }),
    whisperView({ id: 'wait1', inviterId: 'me', inviteeId: 'them', createdAtMs: NOW - MIN }),
    // never listed:
    whisperView({ id: 'gone1', status: 'declined' }),
    whisperView({ id: 'gone2', createdAtMs: NOW - 20 * MIN }),
    openWhisper(61, { id: 'gone3' }),
  ]

  it('shows the three sections, each with its rows', () => {
    const html = renderToStaticMarkup(<WhispersView {...props(list)} />)
    expect(html).toContain('Invites for you')
    expect(html).toContain('kai_9 invited you to a whisper.')
    expect(html).toContain('Open whispers')
    expect(html).toContain('href="#whisper/open1"')
    expect(html).toContain('ola_3')
    expect(html).toContain('Waiting for a reply')
    expect(html).toContain('Waiting for kai_9 to reply.')
    expect(html).toContain('href="#whisper/wait1"')
  })

  it('does not list declined, expired or finished whispers', () => {
    const html = renderToStaticMarkup(<WhispersView {...props(list)} />)
    for (const id of ['gone1', 'gone2', 'gone3']) expect(html).not.toContain(`#whisper/${id}`)
  })

  it('leaves out a section that is empty', () => {
    const html = renderToStaticMarkup(<WhispersView {...props([list[0]])} />)
    expect(html).toContain('Invites for you')
    expect(html).not.toContain('Open whispers')
    expect(html).not.toContain('Waiting for a reply')
    expect(html).not.toContain(INBOX_EMPTY)
  })

  it('never says a whisper is deleted', () => {
    expect(renderToStaticMarkup(<WhispersView {...props(list)} />)).not.toMatch(/delet|erase|remov/i)
  })
})

describe('WhispersPage gate', () => {
  it('an under_13 session sees the notice with a way back, and no whisper hook is called', () => {
    const html = renderToStaticMarkup(<WhispersPage session={session('under_13')} />)
    expect(html.replace(/&#x27;/g, "'")).toContain("Whispers aren't available for this account.")
    expect(html).toContain('href="#"')
    expect(mocks.useWhispers).not.toHaveBeenCalled()
    expect(mocks.useProfiles).not.toHaveBeenCalled()
  })

  it.each(['13_17', '18_plus'] as const)('a %s session opens the list for this person', (band) => {
    renderToStaticMarkup(<WhispersPage session={session(band)} />)
    expect(mocks.useWhispers).toHaveBeenCalledWith('me')
  })

  it('renders the sections from the loaded list', () => {
    mocks.useWhispers.mockReturnValue({
      state: { status: 'ready', data: [whisperView({ id: 'inv1', inviterId: 'them', inviteeId: 'me', createdAtMs: Date.now() - 60_000 })] },
      retry: () => {},
    })
    const html = renderToStaticMarkup(<WhispersPage session={session('18_plus')} />)
    expect(html).toContain('Invites for you')
    expect(html).toContain('kai_9 invited you to a whisper.')
  })

  it('shows the error state when the list is refused', () => {
    mocks.useWhispers.mockReturnValue({ state: { status: 'denied' }, retry: () => {} })
    const html = renderToStaticMarkup(<WhispersPage session={session('18_plus')} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('Try again')
  })

  it('shows the loading state while the list loads', () => {
    expect(renderToStaticMarkup(<WhispersPage session={session('18_plus')} />)).toContain('Loading whispers...')
  })
})
