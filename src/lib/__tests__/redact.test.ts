import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { redact } from '../redact'

const kinds = (t: string) => redact(t).findings.map((f) => f.kind)

describe('redact: finds the usual leaks', () => {
  it('phone numbers in common local and international shapes', () => {
    expect(redact('Call me on 097-1234567 please').redacted).toBe('Call me on [number hidden] please')
    expect(redact('whatsapp +260 97 123 4567').redacted).toBe('whatsapp [number hidden]')
    expect(redact('(021) 555-0199').redacted).toBe('[number hidden]')
  })
  it('emails', () => {
    expect(redact('mail jo.doe+x@example.co.za now').redacted).toBe('mail [email hidden] now')
  })
  it('passwords and PINs hide only the value', () => {
    expect(redact('my password is hunter2!').redacted).toBe('my password is [password hidden]')
    expect(redact('PIN: 4821').redacted).toBe('PIN: [password hidden]')
  })
  it('API keys and tokens', () => {
    // Built from pieces at run time, so no key-shaped text sits in the source for secret scanners to flag.
    // These are made-up strings, not real credentials.
    const fakeGoogle = ['AI', 'za', 'x'.repeat(35)].join('')
    const fakeSecretKey = ['s', 'k', '-', 'y'.repeat(24)].join('')
    const fakeGithub = ['g', 'hp', '_', 'z'.repeat(36)].join('')
    expect(kinds(`key ${fakeGoogle}`)).toEqual(['key'])
    expect(kinds(fakeSecretKey)).toEqual(['key'])
    expect(kinds(fakeGithub)).toEqual(['key'])
    expect(kinds('token a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8')).toEqual(['key'])
  })
  it('card numbers only when the checksum is valid', () => {
    expect(kinds('4111 1111 1111 1111')).toEqual(['card'])
    expect(kinds('4111 1111 1111 1112')).not.toContain('card')
  })
  it('several at once, in order', () => {
    const r = redact('a@b.com or 0971234567')
    expect(r.findings.map((f) => f.kind)).toEqual(['email', 'phone'])
    expect(r.redacted).toBe('[email hidden] or [number hidden]')
  })
})

describe('redact: leaves ordinary chat alone', () => {
  for (const t of [
    'see you at 10:30',
    'it was 2026-11-20',
    'born 12/05/1999',
    'we won 3-2 last night',
    '1,000,000 people watched',
    'room 12 is full',
    'call me maybe',
    'the password reset page is broken',
    'a'.repeat(40),
  ]) {
    it(`no findings: ${t.slice(0, 30)}`, () => expect(redact(t).findings).toEqual([]))
  }
})

describe('redact: properties', () => {
  it('a 7 to 12 digit run never survives', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[1-9][0-9]{6,11}$/), fc.constantFrom('call ', 'num: ', ''), (digits, pre) => {
        const out = redact(`${pre}${digits} ok`).redacted
        expect(out).not.toContain(digits)
      }),
    )
  })
  it('redacting twice changes nothing more', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (s) => {
        const once = redact(s).redacted
        expect(redact(once).redacted).toBe(once)
      }),
    )
  })
  it('text without findings comes back unchanged', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (s) => {
        const r = redact(s)
        if (r.findings.length === 0) expect(r.redacted).toBe(s)
      }),
    )
  })
})