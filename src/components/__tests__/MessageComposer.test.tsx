import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Timestamp } from 'firebase/firestore'
import type { GhostCheck } from '../../hooks/useGhostCheck'
import { getInferenceSnapshot } from '../../lib/inferenceLog'
import type { ComposerTarget } from '../../lib/whisperTarget'
import MessageComposer from '../MessageComposer'

// The composer imports the room sender, which reaches lib/firebase and starts Firebase.
vi.mock('../../lib/firebase', () => ({ db: {}, auth: {} }))

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

const target: ComposerTarget = {
  preCheck: () => null,
  send: async () => ({ status: 'sent' }),
  explain: () => 'x',
}

const CONSENT_LINE = "Allow a cloud check when this device can't do it"
// Static markup writes an apostrophe as an entity.
const text = (html: string) => html.replace(/&#x27;/g, "'")

describe('MessageComposer', () => {
  it('a room composer renders as before: message box, Send, counter, consent line', () => {
    const html = renderToStaticMarkup(
      <MessageComposer roomId="r1" uid="me" openedAtMs={1} expiresAt={{} as Timestamp} createdAtMs={1} ghost={ghost} />,
    )
    expect(html).toContain('aria-label="Message"')
    expect(html).toContain('Say something...')
    expect(html).toContain('>Send<')
    expect(html).toContain('0/280')
    expect(text(html)).toContain(CONSENT_LINE)
  })

  it('a target composer renders with no room props, with the same box, button and consent line', () => {
    const html = renderToStaticMarkup(<MessageComposer target={target} uid="me" createdAtMs={1} ghost={ghost} />)
    expect(html).toContain('aria-label="Message"')
    expect(html).toContain('>Send<')
    expect(html).toContain('0/280')
    expect(text(html)).toContain(CONSENT_LINE)
  })

  it('both composers show the same markup apart from nothing that depends on the target', () => {
    const room = renderToStaticMarkup(
      <MessageComposer roomId="r1" uid="me" openedAtMs={1} expiresAt={{} as Timestamp} createdAtMs={1} ghost={ghost} />,
    )
    const whisper = renderToStaticMarkup(<MessageComposer target={target} uid="me" createdAtMs={1} ghost={ghost} />)
    expect(whisper).toBe(room)
  })
})
