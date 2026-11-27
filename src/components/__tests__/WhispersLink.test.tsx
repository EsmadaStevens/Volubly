import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { whisperView } from '../../lib/__tests__/whisperFixtures'
import type { WhisperView } from '../../lib/whisperTypes'
import WhispersLink, { WhispersLinkView } from '../WhispersLink'

const mocks = vi.hoisted(() => ({ useWhispers: vi.fn() }))
vi.mock('../../hooks/useWhispers', () => ({ useWhispers: mocks.useWhispers }))
vi.mock('../../lib/firebase', () => ({ db: {}, auth: {} }))

const ready = (data: WhisperView[]) => ({ state: { status: 'ready', data }, retry: () => {} })

// The link counts invites against the real clock, so these are made relative to now.
const NOW = Date.now()
const invite = () => whisperView({ createdAtMs: NOW - 60_000 }, NOW)

beforeEach(() => {
  mocks.useWhispers.mockReset()
  mocks.useWhispers.mockReturnValue({ state: { status: 'loading' }, retry: () => {} })
})

describe('WhispersLinkView', () => {
  it('is a link to #whispers with a 44px touch target and no badge when nothing is waiting', () => {
    const html = renderToStaticMarkup(<WhispersLinkView pending={0} />)
    expect(html).toContain('href="#whispers"')
    expect(html).toContain('aria-label="Whispers"')
    expect(html).toContain('min-h-[44px]')
    expect(html).not.toContain('bg-accent')
  })
  it('shows the count and puts it in the accessible name', () => {
    const one = renderToStaticMarkup(<WhispersLinkView pending={1} />)
    expect(one).toContain('aria-label="Whispers, 1 invite"')
    const two = renderToStaticMarkup(<WhispersLinkView pending={2} />)
    expect(two).toContain('aria-label="Whispers, 2 invites"')
    expect(two).toContain('>2<')
  })
})

describe('WhispersLink', () => {
  it('renders nothing for an under_13 account, and reads nothing: no whisper hook is called', () => {
    expect(renderToStaticMarkup(<WhispersLink uid="me" ageBand="under_13" />)).toBe('')
    expect(mocks.useWhispers).not.toHaveBeenCalled()
  })

  it.each(['13_17', '18_plus'] as const)('for %s it opens the whisper list for this person and shows the link', (band) => {
    const html = renderToStaticMarkup(<WhispersLink uid="me" ageBand={band} />)
    expect(mocks.useWhispers).toHaveBeenCalledWith('me')
    expect(html).toContain('href="#whispers"')
    expect(html).toContain('aria-label="Whispers"')
  })

  it('shows the number of pending invites for this person only', () => {
    mocks.useWhispers.mockReturnValue(
      ready([
        invite(),
        invite(),
        whisperView({ inviterId: 'me', inviteeId: 'them', createdAtMs: NOW - 60_000 }, NOW), // sent by me: not counted
        whisperView({ createdAtMs: NOW - 20 * 60_000 }, NOW), // stale: not counted
      ]),
    )
    const html = renderToStaticMarkup(<WhispersLink uid="me" ageBand="18_plus" />)
    expect(html).toContain('aria-label="Whispers, 2 invites"')
  })

  it('shows no badge while loading or after an error', () => {
    mocks.useWhispers.mockReturnValue({ state: { status: 'error', message: 'x' }, retry: () => {} })
    expect(renderToStaticMarkup(<WhispersLink uid="me" ageBand="18_plus" />)).toContain('aria-label="Whispers"')
  })
})
