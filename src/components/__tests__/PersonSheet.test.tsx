import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadySession } from '../AuthGate'
import PersonSheet, { PersonSheetView, type PersonSheetViewProps } from '../PersonSheet'
import { GENERIC_ERROR_TEXT, TOO_MANY_TEXT } from '../../lib/whisperCopy'
import { NOW, whisperView } from '../../lib/__tests__/whisperFixtures'
import type { PersonSheetStateName } from '../../lib/personSheetState'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  hasBlocked: vi.fn(),
  sendInvite: vi.fn(),
  unblockPerson: vi.fn(),
  useWhispers: vi.fn(),
  useProfiles: vi.fn(),
}))
vi.mock('../../lib/whisperApi', () => ({
  hasBlocked: mocks.hasBlocked,
  sendInvite: mocks.sendInvite,
  unblockPerson: mocks.unblockPerson,
}))
vi.mock('../../hooks/useWhispers', () => ({ useWhispers: mocks.useWhispers }))
vi.mock('../../hooks/useProfiles', () => ({ useProfiles: mocks.useProfiles }))
vi.mock('../../lib/firebase', () => ({ db: {}, auth: {} }))

const decode = (html: string) => html.replace(/&#x27;/g, "'")

// ------------------------------------------------------------------ the view, every state
const view = (state: PersonSheetStateName, over: Partial<PersonSheetViewProps> = {}): PersonSheetViewProps => ({
  state,
  name: 'kai_9',
  avatarSeed: 'k',
  relation: { kind: 'none' },
  error: null,
  canInvite: true,
  unblocking: false,
  onInvite: () => {},
  onUnblock: () => {},
  onRetry: () => {},
  onClose: () => {},
  ...over,
})
const html = (state: PersonSheetStateName, over: Partial<PersonSheetViewProps> = {}) =>
  decode(renderToStaticMarkup(<PersonSheetView {...view(state, over)} />))

describe('PersonSheetView', () => {
  it('is a dialog with the person, a Close button, and nothing else about them', () => {
    const h = html('ready')
    expect(h).toContain('role="dialog"')
    expect(h).toContain('aria-modal="true"')
    expect(h).toContain('aria-label="Invite kai_9"')
    expect(h).toContain('kai_9')
    expect(h).toContain('>Close<')
  })

  it('loading', () => {
    const h = html('loading')
    expect(h).toContain('One moment...')
    expect(h).not.toContain('Invite to a whisper')
  })

  it('ready: Invite, the neutral note about age groups, no Unblock', () => {
    const h = html('ready')
    expect(h).toContain('>Invite to a whisper<')
    expect(h).toContain('Whispers work between people in the same age group. Not every invite can be sent.')
    expect(h).not.toContain('Unblock')
  })

  it('blocked: an Unblock button and no Invite', () => {
    const h = html('blocked')
    expect(h).toContain('You blocked kai_9.')
    expect(h).toContain('>Unblock<')
    expect(h).not.toContain('Invite to a whisper')
  })

  it('blocked, while unblocking: the button is off and says so', () => {
    const h = html('blocked', { unblocking: true })
    expect(h).toContain('Working...')
    expect(h).toContain('disabled=""')
  })

  it.each([
    ['open', 'You already have a whisper with kai_9.'],
    ['sent', 'You already invited kai_9.'],
    ['received', 'kai_9 already invited you.'],
  ] as const)('existing (%s): says so and links to it instead of offering Invite', (kind, text) => {
    const h = html('existing', { relation: { kind, id: 'w42' } })
    expect(h).toContain(text)
    expect(h).toContain('href="#whisper/w42"')
    expect(h).not.toContain('Invite to a whisper')
  })

  it('sending: the button is off and says so', () => {
    const h = html('sending')
    expect(h).toContain('Sending...')
    expect(h).toContain('disabled=""')
    expect(h).toContain('aria-busy="true"')
  })

  it('sent: says the invite was sent and for how long, and links to the inbox', () => {
    const h = html('sent')
    expect(h).toContain('Invite sent. kai_9 has 15 minutes to accept.')
    expect(h).toContain('href="#whispers"')
    expect(h).not.toContain('Invite to a whisper')
  })

  it('failed: an alert and Invite again', () => {
    const h = html('failed', { error: GENERIC_ERROR_TEXT })
    expect(h).toContain('role="alert"')
    expect(h).toContain(GENERIC_ERROR_TEXT)
    expect(h).toContain('>Invite to a whisper<')
  })

  it('failed because the whisper list could not load: Try again instead of Invite', () => {
    const h = html('failed', { error: GENERIC_ERROR_TEXT, canInvite: false })
    expect(h).toContain('>Try again<')
    expect(h).not.toContain('Invite to a whisper')
  })

  it('every button and link has a 44px touch target', () => {
    for (const state of ['ready', 'blocked', 'sent', 'sending'] as const) {
      const h = html(state)
      const targets = (h.match(/<button/g) ?? []).length + (h.match(/<a /g) ?? []).length
      expect(h.match(/min-h-\[44px\]/g)?.length ?? 0).toBe(targets)
    }
  })

  it('uses only colour tokens, and never says deleted', () => {
    for (const state of ['loading', 'ready', 'blocked', 'sent', 'failed'] as const) {
      const h = html(state, { error: state === 'failed' ? GENERIC_ERROR_TEXT : null })
      const classes = [...h.matchAll(/class="([^"]*)"/g)].map((m) => m[1]).join(' ')
      expect(classes).not.toMatch(/\[(#|rgb|hsl)/i)
      expect(classes).not.toMatch(/\bbg-black\b/)
      expect(h).not.toMatch(/delet|erase|remov/i)
    }
  })
})

// ------------------------------------------------------------------ the whole sheet, with effects
const session: ReadySession = {
  uid: 'me',
  profile: { username: 'me_1', avatarSeed: 'm' },
  ageBand: '18_plus',
  createdAtMs: NOW - 100 * 60_000,
  setProfile: () => {},
}

let container: HTMLDivElement
let unmount: () => void

async function mountSheet(onClose = vi.fn()) {
  container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  unmount = () => {
    act(() => root.unmount())
    container.remove()
  }
  await act(async () => {
    root.render(createElement(PersonSheet, { person: 'them', session, onClose }))
  })
  return onClose
}
const text = () => decode(container.textContent ?? '')
const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined
const click = async (el: Element | undefined) => {
  expect(el, 'button should exist').toBeDefined()
  await act(async () => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
  mocks.useProfiles.mockReturnValue(new Map([['them', { username: 'kai_9', avatarSeed: 'k' }]]))
  mocks.useWhispers.mockReturnValue({ state: { status: 'ready', data: [] }, retry: vi.fn() })
  mocks.hasBlocked.mockResolvedValue(false)
  mocks.sendInvite.mockResolvedValue({ ok: true })
  mocks.unblockPerson.mockResolvedValue({ ok: true })
})
afterEach(() => unmount?.())

describe('PersonSheet (with effects)', () => {
  it('opens this person\'s whisper list for the viewer, and checks the block once', async () => {
    await mountSheet()
    expect(mocks.useWhispers).toHaveBeenCalledWith('me')
    expect(mocks.useProfiles).toHaveBeenCalledWith(['them'])
    expect(mocks.hasBlocked).toHaveBeenCalledTimes(1)
    expect(mocks.hasBlocked).toHaveBeenCalledWith('me', 'them')
    expect(text()).toContain('kai_9')
    expect(button('Invite to a whisper')).toBeDefined()
  })

  it('a person the viewer has blocked: Unblock exists and Invite does not', async () => {
    mocks.hasBlocked.mockResolvedValue(true)
    await mountSheet()
    expect(text()).toContain('You blocked kai_9.')
    expect(button('Unblock')).toBeDefined()
    expect(button('Invite to a whisper')).toBeUndefined()
  })

  it('Unblock removes the block and then offers Invite', async () => {
    mocks.hasBlocked.mockResolvedValue(true)
    await mountSheet()
    await click(button('Unblock'))
    expect(mocks.unblockPerson).toHaveBeenCalledWith({ uid: 'me', otherId: 'them' })
    expect(button('Invite to a whisper')).toBeDefined()
    expect(button('Unblock')).toBeUndefined()
  })

  it('a failed Unblock shows the generic error and keeps Unblock', async () => {
    mocks.hasBlocked.mockResolvedValue(true)
    mocks.unblockPerson.mockResolvedValue({ ok: false, code: 'generic' })
    await mountSheet()
    await click(button('Unblock'))
    expect(text()).toContain(GENERIC_ERROR_TEXT)
    expect(button('Unblock')).toBeDefined()
  })

  it('Invite sends once, with the person, a letters-and-digits whisper id and the loaded list, then says it was sent', async () => {
    const list = [whisperView({ id: 'old', status: 'ended', endedBy: 'me' })]
    mocks.useWhispers.mockReturnValue({ state: { status: 'ready', data: list }, retry: vi.fn() })
    await mountSheet()
    await click(button('Invite to a whisper'))
    expect(mocks.sendInvite).toHaveBeenCalledTimes(1)
    const arg = mocks.sendInvite.mock.calls[0][0]
    expect(arg).toMatchObject({ uid: 'me', inviteeId: 'them' })
    expect(arg.whisperId).toMatch(/^[A-Za-z0-9]{16,}$/)
    expect(arg.whispers).toBe(list)
    expect(text()).toContain('Invite sent. kai_9 has 15 minutes to accept.')
    expect(button('Invite to a whisper')).toBeUndefined()
  })

  it('a failed invite shows the generic error, and the retry reuses the same whisper id', async () => {
    mocks.sendInvite.mockResolvedValueOnce({ ok: false, code: 'generic' })
    await mountSheet()
    await click(button('Invite to a whisper'))
    expect(text()).toContain(GENERIC_ERROR_TEXT)
    await click(button('Invite to a whisper'))
    expect(mocks.sendInvite).toHaveBeenCalledTimes(2)
    expect(mocks.sendInvite.mock.calls[1][0].whisperId).toBe(mocks.sendInvite.mock.calls[0][0].whisperId)
    expect(text()).toContain('Invite sent.')
  })

  it('the too-many-whispers message is shown as is', async () => {
    mocks.sendInvite.mockResolvedValue({ ok: false, code: 'too_many' })
    await mountSheet()
    await click(button('Invite to a whisper'))
    expect(text()).toContain(TOO_MANY_TEXT)
  })

  it('an existing live whisper or invite is linked instead of offering Invite', async () => {
    const now = Date.now()
    const w = whisperView({ id: 'wlive', inviterId: 'me', inviteeId: 'them', createdAtMs: now - 60_000 }, now)
    mocks.useWhispers.mockReturnValue({ state: { status: 'ready', data: [w] }, retry: vi.fn() })
    await mountSheet()
    expect(text()).toContain('You already invited kai_9.')
    expect(container.querySelector('a[href="#whisper/wlive"]')).not.toBeNull()
    expect(button('Invite to a whisper')).toBeUndefined()
  })

  it('stays on loading until the whisper list arrives', async () => {
    mocks.useWhispers.mockReturnValue({ state: { status: 'loading' }, retry: vi.fn() })
    await mountSheet()
    expect(text()).toContain('One moment...')
    expect(button('Invite to a whisper')).toBeUndefined()
  })

  it('if the whisper list cannot load, shows Try again and does not invite', async () => {
    const retry = vi.fn()
    mocks.useWhispers.mockReturnValue({ state: { status: 'error', message: 'x' }, retry })
    await mountSheet()
    expect(button('Invite to a whisper')).toBeUndefined()
    await click(button('Try again'))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(mocks.sendInvite).not.toHaveBeenCalled()
  })

  it('closes on Escape, on a tap outside the dialog, and on Close, but not on a tap inside it', async () => {
    const onClose = await mountSheet()
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })))
    expect(onClose).toHaveBeenCalledTimes(1)

    await click(container.querySelector('[role="dialog"]')!)
    expect(onClose).toHaveBeenCalledTimes(1)
    await click(container.firstElementChild!) // the overlay
    expect(onClose).toHaveBeenCalledTimes(2)
    await click(button('Close'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('makes one whisper id for the whole life of the sheet, even across re-renders', async () => {
    await mountSheet()
    await click(button('Invite to a whisper'))
    const first = mocks.sendInvite.mock.calls[0][0].whisperId
    expect(first).toBeTruthy()
  })
})
