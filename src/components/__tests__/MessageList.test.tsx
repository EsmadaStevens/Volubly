import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { MessagesState } from '../../hooks/useMessages'
import MessageList from '../MessageList'
import type { MessageView } from '../../types'

// useProfiles reaches lib/firebase, which starts Firebase. The list does not need it here.
vi.mock('../../lib/firebase', () => ({ db: {}, auth: {} }))
// A fixed profile for every real sender, so the name is known on the first render.
vi.mock('../../hooks/useProfiles', () => ({
  useProfiles: (uids: string[]) => new Map(uids.map((u) => [u, { username: `user_${u}`, avatarSeed: u }])),
}))

const m = (id: string, senderId: string, over: Partial<MessageView> = {}): MessageView => ({
  id,
  senderId,
  body: `body ${id}`,
  sentAtMs: 1_800_000_000_000,
  pending: false,
  ...over,
})
const ready = (messages: MessageView[]): MessagesState => ({ status: 'ready', messages })
const base = { hidden: new Map(), held: new Map(), uid: 'me' }

describe('MessageList texts', () => {
  it('keeps the room wording by default', () => {
    expect(renderToStaticMarkup(<MessageList state={{ status: 'closed' }} {...base} />)).toContain('This room has closed.')
    expect(renderToStaticMarkup(<MessageList state={ready([])} {...base} />)).toContain('No messages yet. Say something to get it started.')
  })
  it('shows custom texts when given', () => {
    expect(renderToStaticMarkup(<MessageList state={{ status: 'closed' }} {...base} closedText="This whisper has ended." />)).toContain('This whisper has ended.')
    const html = renderToStaticMarkup(<MessageList state={ready([])} {...base} emptyText="Nothing yet." />)
    expect(html).toContain('Nothing yet.')
    expect(html).not.toContain('Say something to get it started')
  })
})

describe('MessageList name buttons', () => {
  it('has no name buttons unless onPickPerson and viewerBand are given', () => {
    const html = renderToStaticMarkup(<MessageList state={ready([m('1', 'p')])} {...base} />)
    expect(html).not.toContain('aria-label="Open')
    const noBand = renderToStaticMarkup(<MessageList state={ready([m('1', 'p')])} {...base} onPickPerson={vi.fn()} />)
    expect(noBand).not.toContain('aria-label="Open')
  })

  it("makes another person's name a button", () => {
    const html = renderToStaticMarkup(<MessageList state={ready([m('1', 'p')])} {...base} onPickPerson={vi.fn()} viewerBand="18_plus" />)
    expect(html).toContain('aria-label="Open user_p"')
  })

  it('a simulated demo message never gets a name button, even with a handler', () => {
    const html = renderToStaticMarkup(
      <MessageList state={ready([m('1', 'sim1', { simulated: true })])} {...base} onPickPerson={vi.fn()} viewerBand="18_plus" />,
    )
    expect(html).not.toContain('aria-label="Open')
  })

  it("the reader's own message never gets one", () => {
    const html = renderToStaticMarkup(<MessageList state={ready([m('1', 'me')])} {...base} onPickPerson={vi.fn()} viewerBand="18_plus" />)
    expect(html).not.toContain('aria-label="Open')
  })

  it('an under_13 viewer gets none', () => {
    const html = renderToStaticMarkup(<MessageList state={ready([m('1', 'p')])} {...base} onPickPerson={vi.fn()} viewerBand="under_13" />)
    expect(html).not.toContain('aria-label="Open')
  })
})
