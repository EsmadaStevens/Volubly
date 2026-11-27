import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadySession } from '../../components/AuthGate'
import type { GhostCheck } from '../../hooks/useGhostCheck'
import type { MessagesState } from '../../hooks/useMessages'
import { getInferenceSnapshot } from '../../lib/inferenceLog'
import { MIN, openWhisper, whisperView } from '../../lib/__tests__/whisperFixtures'
import { whisperStage } from '../../lib/whisperStage'
import type { WhisperView } from '../../lib/whisperTypes'
import type { SubState } from '../../lib/whisperWatch'
import type { MessageView, PublicProfile } from '../../types'
import WhisperPage, { OpenChat, WhisperPageView, type WhisperPageViewProps } from '../WhisperPage'

const mocks = vi.hoisted(() => ({
  useWhisper: vi.fn(),
  useWhisperMessages: vi.fn(),
  useProfiles: vi.fn(),
  useGhostCheck: vi.fn(),
  useMessageGuard: vi.fn(),
}))
vi.mock('../../hooks/useWhisper', () => ({ useWhisper: mocks.useWhisper }))
vi.mock('../../hooks/useWhisperMessages', () => ({ useWhisperMessages: mocks.useWhisperMessages }))
vi.mock('../../hooks/useProfiles', () => ({ useProfiles: mocks.useProfiles }))
// These two read a store with no server snapshot, which a static render cannot do. Stubbed, as in the composer test.
vi.mock('../../hooks/useGhostCheck', () => ({ useGhostCheck: mocks.useGhostCheck }))
vi.mock('../../hooks/useMessageGuard', () => ({ useMessageGuard: mocks.useMessageGuard }))
vi.mock('../../lib/firebase', () => ({ db: {}, auth: {} }))

// The open chat reads the real clock (the deadline and the countdown), so these are built from now.
const now = () => Date.now()
const kai: PublicProfile = { username: 'kai_9', avatarSeed: 'k' }
const profiles = new Map<string, PublicProfile | null>([['them', kai]])

const session = (band: ReadySession['ageBand'] = '18_plus'): ReadySession => ({
  uid: 'me',
  profile: { username: 'me_1', avatarSeed: 'm' },
  ageBand: band,
  createdAtMs: now() - 100 * MIN,
  setProfile: () => {},
})

const message = (over: Partial<MessageView> = {}): MessageView => ({
  id: 'm1',
  senderId: 'them',
  body: 'hello there',
  sentAtMs: now() - 1000,
  pending: false,
  ...over,
})

/** Behaves like the real hook: disabled means closed, with no messages. */
const realisticMessages = (list: MessageView[]) => (_id: string, enabled: boolean): MessagesState =>
  enabled ? { status: 'ready', messages: list } : { status: 'closed' }

const noop = async () => ({ ok: true }) as const
const decode = (html: string) => html.replace(/&#x27;/g, "'")
const CONSENT_LINE = "Allow a cloud check when this device can't do it"

const ghost = {
  snap: getInferenceSnapshot(),
  cloudConsent: false,
  setCloudConsent: () => {},
  progress: null,
  turnOnDevice: async () => {},
  warm: () => {},
  review: async () => {
    throw new Error('not used in a static render')
  },
  warming: false,
  needsWake: () => false,
} as unknown as GhostCheck

beforeEach(() => {
  mocks.useGhostCheck.mockReset()
  mocks.useGhostCheck.mockReturnValue(ghost)
  mocks.useMessageGuard.mockReset()
  mocks.useMessageGuard.mockReturnValue(new Map())
  mocks.useWhisper.mockReset()
  mocks.useWhisperMessages.mockReset()
  mocks.useProfiles.mockReset()
  mocks.useProfiles.mockReturnValue(profiles)
  mocks.useWhisperMessages.mockImplementation(realisticMessages([message()]))
  mocks.useWhisper.mockReturnValue({ state: { status: 'loading' }, retry: () => {} })
})

const chat = (whisper: WhisperView, over: { note?: string | null } = {}) => (
  <OpenChat
    whisper={whisper}
    session={session()}
    otherId="them"
    profile={kai}
    onClosed={() => {}}
    onEnd={noop}
    onEndBlock={noop}
    note={over.note ?? null}
  />
)
const mine = (ageMin: number) => openWhisper(ageMin, { id: 'w1', inviterId: 'me', inviteeId: 'them' }, now())

describe('OpenChat, while the thread is open', () => {
  it('shows the header, the countdown, the plain statement, the messages and the composer', () => {
    const html = decode(renderToStaticMarkup(chat(mine(10))))
    expect(html).toContain('kai_9')
    expect(html).toContain('role="timer"')
    expect(html).toMatch(/\d{2}:\d{2} left/)
    expect(html).toContain('Only you and kai_9 can read this in the app. It ends 1 hour after it was accepted.')
    expect(html).toContain('hello there')
    expect(html).toContain('aria-label="Message"')
    expect(html).toContain('End whisper')
    expect(html).toContain('End and block')
  })

  it('listens to the messages, and only while open', () => {
    renderToStaticMarkup(chat(mine(10)))
    expect(mocks.useWhisperMessages).toHaveBeenCalledWith('w1', true)
  })

  it('shows the same cloud-check consent line as the room composer', () => {
    expect(decode(renderToStaticMarkup(chat(mine(10))))).toContain(CONSENT_LINE)
  })

  it('keeps the AI status visible on wide screens too (a compact copy above the composer)', () => {
    const html = renderToStaticMarkup(chat(mine(10)))
    expect(html).toContain('hidden px-3 pt-2 lg:block')
    expect(html).toContain('Ghost-Mode')
  })

  it('uses the whisper wording when there are no messages yet, and never says deleted', () => {
    mocks.useWhisperMessages.mockImplementation(realisticMessages([]))
    const html = renderToStaticMarkup(chat(mine(10)))
    expect(html).toContain('No messages yet. Say something to get it started.')
    expect(html).not.toMatch(/delet|erase|remov/i)
  })

  it('has no Delay Shield, catch-up bar or unseen count (those are room features)', () => {
    const html = renderToStaticMarkup(chat(mine(10)))
    expect(html).not.toContain('Delay Shield')
    expect(html).not.toContain('Held back')
  })
})

describe('OpenChat, once the hour is over', () => {
  it('shows "This whisper has ended." and none of the thread: no messages, no composer, no countdown', () => {
    const html = renderToStaticMarkup(chat(mine(61)))
    expect(html).toContain('This whisper has ended.')
    expect(html).not.toContain('hello there')
    expect(html).not.toContain('aria-label="Message"')
    expect(html).not.toContain('role="timer"')
    expect(html).not.toContain('End whisper')
  })

  it('unsubscribes: the messages hook is asked for disabled', () => {
    renderToStaticMarkup(chat(mine(61)))
    expect(mocks.useWhisperMessages).toHaveBeenCalledWith('w1', false)
    expect(mocks.useWhisperMessages).not.toHaveBeenCalledWith('w1', true)
  })

  it('drops the messages even if a stale hook result still holds them', () => {
    mocks.useWhisperMessages.mockReturnValue({ status: 'ready', messages: [message()] })
    const html = renderToStaticMarkup(chat(mine(61)))
    expect(html).toContain('This whisper has ended.')
    expect(html).not.toContain('hello there')
  })

  it('treats a refused messages listener (clock behind the server) as ended', () => {
    mocks.useWhisperMessages.mockReturnValue({ status: 'closed' })
    const html = renderToStaticMarkup(chat(mine(10)))
    expect(html).toContain('This whisper has ended.')
    expect(html).not.toContain('aria-label="Message"')
  })

  it('says it ends at the hour, with a way back to the whispers', () => {
    const html = renderToStaticMarkup(chat(mine(61)))
    expect(html).toContain('href="#whispers"')
    expect(html).toContain('Back to whispers')
  })

  it('shows the note after End and block', () => {
    const html = renderToStaticMarkup(chat(mine(61), { note: 'You blocked kai_9.' }))
    expect(html).toContain('You blocked kai_9.')
  })
})

describe('WhisperPageView, every stage but open', () => {
  const view = (stage: WhisperPageViewProps['stage'], over: Partial<WhisperPageViewProps> = {}): WhisperPageViewProps => ({
    stage,
    whisper: null,
    otherId: 'them',
    profile: kai,
    nowMs: now(),
    note: null,
    errorMessage: '',
    onRetry: () => {},
    actions: { accept: noop, decline: noop, declineBlock: noop, cancel: noop },
    open: <p>OPEN CHAT</p>,
    ...over,
  })
  const pendingFromThem = () => whisperView({ id: 'w1', inviterId: 'them', inviteeId: 'me', createdAtMs: now() - 60_000 }, now())
  const pendingFromMe = () => whisperView({ id: 'w1', inviterId: 'me', inviteeId: 'them', createdAtMs: now() - 60_000 }, now())

  it('loading', () => {
    const html = renderToStaticMarkup(<WhisperPageView {...view('loading')} />)
    expect(html).toContain('Opening whisper...')
    expect(html).toContain('role="status"')
  })

  it('error: a plain message as an alert and Try again', () => {
    const html = decode(renderToStaticMarkup(<WhisperPageView {...view('error', { errorMessage: "We couldn't open this whisper. Check your connection and try again." })} />))
    expect(html).toContain('role="alert"')
    expect(html).toContain("We couldn't open this whisper.")
    expect(html).toContain('>Try again<')
  })

  it('unavailable', () => {
    expect(decode(renderToStaticMarkup(<WhisperPageView {...view('unavailable')} />))).toContain("This whisper isn't available.")
  })

  it('invite as the invitee: Accept, Decline and Decline and block, and the time left', () => {
    const html = renderToStaticMarkup(<WhisperPageView {...view('invite_invitee', { whisper: pendingFromThem() })} />)
    expect(html).toContain('kai_9 invited you to a whisper.')
    expect(html).toContain('>Accept<')
    expect(html).toContain('>Decline<')
    expect(html).toContain('>Decline and block<')
    expect(html).toContain('14 min left')
  })

  it('invite as the inviter: waiting, with Cancel invite', () => {
    const html = renderToStaticMarkup(<WhisperPageView {...view('invite_inviter', { whisper: pendingFromMe() })} />)
    expect(html).toContain('Waiting for kai_9 to reply.')
    expect(html).toContain('>Cancel invite<')
    expect(html).not.toContain('>Accept<')
  })

  it('invite expired', () => {
    expect(renderToStaticMarkup(<WhisperPageView {...view('invite_expired')} />)).toContain('This invite expired.')
  })

  it('ended: says so with no cause, and shows the note when there is one', () => {
    const plain = renderToStaticMarkup(<WhisperPageView {...view('ended')} />)
    expect(plain).toContain('This whisper has ended.')
    expect(plain).not.toMatch(/block|declin|age|band/i)
    expect(renderToStaticMarkup(<WhisperPageView {...view('ended', { note: 'You blocked kai_9.' })} />)).toContain('You blocked kai_9.')
  })

  it('open shows whatever the page passes in', () => {
    expect(renderToStaticMarkup(<WhisperPageView {...view('open')} />)).toContain('OPEN CHAT')
  })

  it('every non-open stage has a link back, and none says deleted', () => {
    for (const stage of ['loading', 'error', 'unavailable', 'invite_expired', 'ended'] as const) {
      const html = renderToStaticMarkup(<WhisperPageView {...view(stage)} />)
      expect(html).toContain('href="#whispers"')
      expect(html).not.toMatch(/delet|erase|remov/i)
    }
  })
})

describe('WhisperPage (the whole page, with the hooks stubbed)', () => {
  const ready = (w: WhisperView): { state: SubState<WhisperView>; retry: () => void } => ({ state: { status: 'ready', data: w }, retry: () => {} })

  it('an under_13 session sees the notice with a way back, and no whisper hook is called', () => {
    const html = decode(renderToStaticMarkup(<WhisperPage id="w1" session={session('under_13')} />))
    expect(html).toContain("Whispers aren't available for this account.")
    expect(html).toContain('href="#"')
    expect(mocks.useWhisper).not.toHaveBeenCalled()
    expect(mocks.useWhisperMessages).not.toHaveBeenCalled()
    expect(mocks.useProfiles).not.toHaveBeenCalled()
  })

  it.each(['13_17', '18_plus'] as const)('a %s session opens this whisper', (band) => {
    renderToStaticMarkup(<WhisperPage id="w1" session={session(band)} />)
    expect(mocks.useWhisper).toHaveBeenCalledWith('w1')
  })

  it('loading', () => {
    expect(renderToStaticMarkup(<WhisperPage id="w1" session={session()} />)).toContain('Opening whisper...')
  })

  it('a refused or missing whisper is "not available"', () => {
    mocks.useWhisper.mockReturnValue({ state: { status: 'denied' }, retry: () => {} })
    expect(decode(renderToStaticMarkup(<WhisperPage id="w1" session={session()} />))).toContain("This whisper isn't available.")
  })

  it('a connection error shows the message and Try again', () => {
    mocks.useWhisper.mockReturnValue({ state: { status: 'error', message: 'Check your connection.' }, retry: () => {} })
    const html = renderToStaticMarkup(<WhisperPage id="w1" session={session()} />)
    expect(html).toContain('Check your connection.')
    expect(html).toContain('Try again')
  })

  it('a pending invite for me shows the reply form', () => {
    mocks.useWhisper.mockReturnValue(ready(whisperView({ id: 'w1', inviterId: 'them', inviteeId: 'me', createdAtMs: now() - 60_000 }, now())))
    const html = renderToStaticMarkup(<WhisperPage id="w1" session={session()} />)
    expect(html).toContain('kai_9 invited you to a whisper.')
    expect(html).toContain('>Accept<')
  })

  it('an invite I sent shows the waiting card', () => {
    mocks.useWhisper.mockReturnValue(ready(whisperView({ id: 'w1', inviterId: 'me', inviteeId: 'them', createdAtMs: now() - 60_000 }, now())))
    expect(renderToStaticMarkup(<WhisperPage id="w1" session={session()} />)).toContain('Waiting for kai_9 to reply.')
  })

  it('a stale invite says it expired', () => {
    mocks.useWhisper.mockReturnValue(ready(whisperView({ id: 'w1', createdAtMs: now() - 20 * MIN }, now())))
    expect(renderToStaticMarkup(<WhisperPage id="w1" session={session()} />)).toContain('This invite expired.')
  })

  it('a declined or ended whisper shows the ended view', () => {
    for (const status of ['declined', 'ended'] as const) {
      mocks.useWhisper.mockReturnValue(ready(whisperView({ id: 'w1', status }, now())))
      expect(renderToStaticMarkup(<WhisperPage id="w1" session={session()} />)).toContain('This whisper has ended.')
    }
  })

  it('an open whisper shows the chat', () => {
    mocks.useWhisper.mockReturnValue(ready(mine(10)))
    const html = renderToStaticMarkup(<WhisperPage id="w1" session={session()} />)
    expect(html).toContain('hello there')
    expect(html).toContain('role="timer"')
    expect(mocks.useWhisperMessages).toHaveBeenCalledWith('w1', true)
  })

  it('an open whisper past the hour shows the ended view and listens to nothing', () => {
    mocks.useWhisper.mockReturnValue(ready(mine(61)))
    const html = renderToStaticMarkup(<WhisperPage id="w1" session={session()} />)
    expect(html).toContain('This whisper has ended.')
    expect(html).not.toContain('hello there')
    expect(mocks.useWhisperMessages).not.toHaveBeenCalled() // the stage is 'ended', so the chat is never mounted
  })

  it('the stage and the page agree on a thread that is open', () => {
    const w = mine(10)
    expect(whisperStage({ sub: { status: 'ready', data: w }, uid: 'me', nowMs: now(), forcedEnd: false })).toBe('open')
  })
})
