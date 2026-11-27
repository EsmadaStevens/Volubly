import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { GENERIC_ERROR_TEXT } from '../../lib/whisperCopy'
import { WhisperHeaderView, CountdownChip, type WhisperHeaderViewProps } from '../WhisperHeader'

vi.mock('../../lib/firebase', () => ({ db: {}, auth: {} }))

const base = (over: Partial<WhisperHeaderViewProps> = {}): WhisperHeaderViewProps => ({
  name: 'kai_9',
  avatarSeed: 'k',
  endMs: Date.now() + 42 * 60_000 + 10_000,
  confirm: null,
  busy: null,
  error: null,
  finished: false,
  onAsk: () => {},
  onKeep: () => {},
  onConfirm: () => {},
  ...over,
})

describe('CountdownChip', () => {
  it('is a timer showing mm:ss left', () => {
    const html = renderToStaticMarkup(<CountdownChip endMs={Date.now() + 42 * 60_000 + 10_000} />)
    expect(html).toContain('role="timer"')
    expect(html).toMatch(/4[12]:\d{2} left/)
  })
  it('shows 00:00 left once the end has passed, never a negative', () => {
    const html = renderToStaticMarkup(<CountdownChip endMs={Date.now() - 5000} />)
    expect(html.replace(/<[^>]*>/g, '')).toBe('00:00 left')
  })
})

describe('WhisperHeaderView', () => {
  it('shows who, the countdown, the plain statement of who can read it, and the two actions', () => {
    const html = renderToStaticMarkup(<WhisperHeaderView {...base()} />)
    expect(html).toContain('kai_9')
    expect(html).toContain('role="timer"')
    expect(html).toContain('Only you and kai_9 can read this in the app. It ends 1 hour after it was accepted.')
    expect(html).toContain('>End whisper<')
    expect(html).toContain('>End and block<')
    expect(html).toContain('href="#whispers"')
    expect(html).toContain('Back to whispers')
  })

  it('every button and link has a 44px touch target', () => {
    const html = renderToStaticMarkup(<WhisperHeaderView {...base()} />)
    const targets = (html.match(/<button/g) ?? []).length + (html.match(/<a /g) ?? []).length
    expect(html.match(/min-h-\[44px\]/g)).toHaveLength(targets)
  })

  it('asks once before ending, with End and Keep chatting', () => {
    const html = renderToStaticMarkup(<WhisperHeaderView {...base({ confirm: 'end' })} />)
    expect(html).toContain('End this whisper?')
    expect(html).toContain('>End<')
    expect(html).toContain('>Keep chatting<')
    expect(html).not.toContain('>End whisper<')
  })

  it('asks once before ending and blocking, and names the person', () => {
    const html = renderToStaticMarkup(<WhisperHeaderView {...base({ confirm: 'block' })} />)
    expect(html).toContain('End this whisper and block kai_9?')
    expect(html).toContain('>End and block<')
    expect(html).toContain('>Keep chatting<')
  })

  it('while the action runs, the buttons are off and say so', () => {
    const html = renderToStaticMarkup(<WhisperHeaderView {...base({ confirm: 'end', busy: 'end' })} />)
    expect(html).toContain('Working...')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
  })

  it('shows an error as an alert', () => {
    const html = renderToStaticMarkup(<WhisperHeaderView {...base({ error: GENERIC_ERROR_TEXT })} />)
    expect(html).toContain('role="alert"')
  })

  it('says "ends", never "deleted"', () => {
    for (const confirm of [null, 'end', 'block'] as const) {
      expect(renderToStaticMarkup(<WhisperHeaderView {...base({ confirm })} />)).not.toMatch(/delet|erase|remov/i)
    }
  })
})
