import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { whisperView, NOW, MIN } from '../../lib/__tests__/whisperFixtures'
import { GENERIC_ERROR_TEXT } from '../../lib/whisperCopy'
import InviteCard, { InviteCardView, type InviteCardViewProps } from '../InviteCard'

// InviteCard imports lib/whisperApi (types only at run time) and the busy hook; nothing here needs Firebase.
vi.mock('../../lib/firebase', () => ({ db: {}, auth: {} }))

const base = (over: Partial<InviteCardViewProps> = {}): InviteCardViewProps => ({
  whisper: whisperView({ createdAtMs: NOW - MIN }), // 14 minutes left
  profile: { username: 'sam_22', avatarSeed: 'seed' },
  nowMs: NOW,
  busy: null,
  error: null,
  finished: false,
  onAccept: () => {},
  onDecline: () => {},
  onDeclineBlock: () => {},
  ...over,
})

describe('InviteCardView', () => {
  it('shows who invited, the time left, and the three actions', () => {
    const html = renderToStaticMarkup(<InviteCardView {...base()} />)
    expect(html).toContain('sam_22 invited you to a whisper.')
    expect(html).toContain('14 min left')
    expect(html).toContain('>Accept<')
    expect(html).toContain('>Decline<')
    expect(html).toContain('>Decline and block<')
  })

  it('every button has a 44px touch target', () => {
    const html = renderToStaticMarkup(<InviteCardView {...base()} />)
    expect(html.match(/<button/g)).toHaveLength(3)
    expect(html.match(/min-h-\[44px\]/g)).toHaveLength(3)
  })

  it('says "Under a minute left" in the last minute', () => {
    const html = renderToStaticMarkup(<InviteCardView {...base({ whisper: whisperView({ createdAtMs: NOW - 15 * MIN + 20_000 }) })} />)
    expect(html).toContain('Under a minute left')
  })

  it('shows "..." while the profile loads, and "Unknown" when there is none', () => {
    expect(renderToStaticMarkup(<InviteCardView {...base({ profile: undefined })} />)).toContain('... invited you')
    expect(renderToStaticMarkup(<InviteCardView {...base({ profile: null })} />)).toContain('Unknown invited you')
  })

  it('while one action runs, all buttons are off and the running one says so', () => {
    const html = renderToStaticMarkup(<InviteCardView {...base({ busy: 'accept' })} />)
    expect(html.match(/disabled=""/g)).toHaveLength(3)
    expect(html).toContain('Working...')
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('>Accept<')
  })

  it('after a success the buttons stay off until the card goes away', () => {
    const html = renderToStaticMarkup(<InviteCardView {...base({ finished: true })} />)
    expect(html.match(/disabled=""/g)).toHaveLength(3)
  })

  it('shows an error as an alert', () => {
    const html = renderToStaticMarkup(<InviteCardView {...base({ error: GENERIC_ERROR_TEXT })} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain(GENERIC_ERROR_TEXT.replace("'", '&#x27;'))
  })

  it('uses only the colour tokens in its class names, never a fixed colour', () => {
    const html = renderToStaticMarkup(<InviteCardView {...base({ error: 'x' })} />)
    const classes = [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1]).join(' ')
    expect(classes.length).toBeGreaterThan(0)
    expect(classes).not.toMatch(/\[(#|rgb|hsl)/i)
    for (const token of classes.match(/\b(?:bg|text)-[a-z-]+/g) ?? []) {
      expect(token).toMatch(/^(bg|text)-(night|surface|raised|line|ink|muted|accent|accent-deep|spark|live|warn|danger|plum|xs|sm|base|lg|xl|center)$/)
    }
  })
})

describe('InviteCard (with its own state)', () => {
  it('renders the same card, idle', () => {
    const html = renderToStaticMarkup(
      <InviteCard
        whisper={whisperView({ createdAtMs: NOW - MIN })}
        profile={{ username: 'sam_22', avatarSeed: 's' }}
        nowMs={NOW}
        onAccept={async () => ({ ok: true })}
        onDecline={async () => ({ ok: true })}
        onDeclineBlock={async () => ({ ok: true })}
      />,
    )
    expect(html).toContain('>Accept<')
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('disabled=""')
  })
})
