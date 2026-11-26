import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import * as copy from '../whisperCopy'
import { whisperErrorText, type WhisperErrorCode } from '../whisperErrors'

/** Every string the copy module can produce, with sample names and numbers filled in. */
function allCopy(): string[] {
  const out: string[] = []
  for (const value of Object.values(copy)) {
    if (typeof value === 'string') out.push(value)
    else if (typeof value === 'function') {
      const f = value as (...a: unknown[]) => string
      out.push(f('Sam', 'open'), f('Sam', 'sent'), f('Sam', 'received'), f('12:34'), f(0), f(1), f(5))
    }
  }
  return out
}

// Whole words, any case. "delet", "eras" and "remov" are stems.
const NEVER_IN_COPY = /\b(delet\w*|eras\w*|remov\w*|encrypt\w*|secure|safe|safely|safety|bot|bots)\b|private from|100%|end-to-end|zero logs/i
// Words that would explain why something failed or reveal something about the other person.
const NEVER_IN_ERRORS = /\b(block|blocks|blocked|blocking|age|ages|band|bands|adult|adults|teen|teens|teenager|teenagers|minor|minors)\b/i

const CODES: WhisperErrorCode[] = ['too_many', 'invite_expired', 'generic']

describe('whisper copy', () => {
  it('has strings to check', () => {
    expect(allCopy().length).toBeGreaterThan(30)
  })

  it('never says deleted, erased, removed, encrypted, safe, secure, bot or a total-privacy claim', () => {
    for (const s of allCopy()) expect(s, s).not.toMatch(NEVER_IN_COPY)
  })

  it('says "ends" for threads, and the chat note says who can read it without claiming more', () => {
    expect(copy.WHISPER_ENDED).toBe('This whisper has ended.')
    expect(copy.chatNote('Sam')).toBe('Only you and Sam can read this in the app. It ends 1 hour after it was accepted.')
    expect(copy.SEND_CLOSED).toContain('ended')
  })

  it('uses the exact wording for the account notice and the inbox empty state', () => {
    expect(copy.ACCOUNT_NOT_ALLOWED).toBe("Whispers aren't available for this account.")
    expect(copy.INBOX_EMPTY).toBe('No whispers right now. Tap a name in a room to invite someone.')
  })

  it('does not hint at an age limit anywhere except the one neutral sheet sentence', () => {
    const withAge = allCopy().filter((s) => /\bage\b/i.test(s))
    expect(withAge).toEqual([copy.SHEET_NOTE])
    expect(copy.SHEET_NOTE).toBe('Whispers work between people in the same age group. Not every invite can be sent.')
    for (const s of allCopy()) expect(s, s).not.toMatch(/\b(under|over)\s+\d|\b1[38]\b|cutoff|child/i)
  })

  it('names the Home link by pending invites', () => {
    expect(copy.whispersLinkName(0)).toBe('Whispers')
    expect(copy.whispersLinkName(1)).toBe('Whispers, 1 invite')
    expect(copy.whispersLinkName(3)).toBe('Whispers, 3 invites')
  })

  it('formats the countdown label and the invite-sent line', () => {
    expect(copy.countdownLabel('42:10')).toBe('42:10 left')
    expect(copy.inviteSent('Sam')).toBe('Invite sent. Sam has 15 minutes to accept.')
  })

  it('property: a name never changes which words are forbidden', () => {
    fc.assert(
      fc.property(fc.constantFrom('Sam', 'Kai', 'ana_22', 'x'), (name) => {
        for (const s of [copy.chatNote(name), copy.inviteSent(name), copy.waitingFor(name), copy.invitedBy(name), copy.blockResult(name), copy.sheetBlocked(name)]) {
          expect(s).not.toMatch(NEVER_IN_COPY)
        }
      }),
    )
  })
})

describe('whisper error texts', () => {
  it('has exactly two specific messages and one generic, all different', () => {
    const texts = CODES.map(whisperErrorText)
    expect(new Set(texts).size).toBe(3)
    expect(whisperErrorText('too_many')).toBe('You have too many whispers open. End one or wait for one to finish, then try again.')
    expect(whisperErrorText('invite_expired')).toBe('This invite expired.')
    expect(whisperErrorText('generic')).toBe("That didn't work. Check your connection and try again.")
  })

  it('never mentions a block, an age, a band, an adult, a teen or a minor', () => {
    for (const code of CODES) expect(whisperErrorText(code), code).not.toMatch(NEVER_IN_ERRORS)
  })

  it('the error texts also pass the general copy scan', () => {
    for (const code of CODES) expect(whisperErrorText(code)).not.toMatch(NEVER_IN_COPY)
  })
})
