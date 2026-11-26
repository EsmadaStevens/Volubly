import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { hiddenReason, linkReason, patternReason, READER_LABEL, READER_REASON, verdictReason } from '../messageGuard'
import { VERDICTS } from '../draftCheck'

describe('messageGuard', () => {
  it('hides messages with a phone number or email, with a plain reason', () => {
    expect(patternReason('call me on 097 123 4567')?.text).toContain('phone number')
    expect(patternReason('mail me a@b.com')?.text).toContain('email address')
  })
  it('leaves normal chat alone', () => {
    expect(hiddenReason('what a goal, 3-2 at 10:30, e.g. wow', null)).toBeNull()
  })
  it('hides links with a "make sure you trust it" note, and is sure about explicit ones', () => {
    const r = linkReason('check https://example.com/x')
    expect(r?.text).toContain('make sure you trust it')
    expect(r?.label).toBe('Link found')
    expect(r?.uncertain).toBe(false)
    expect(linkReason('go to www.thing.org')?.uncertain).toBe(false)
  })
  it('also catches a bare web address, but admits it may be wrong', () => {
    const r = linkReason('paypa1-security-update.com')
    expect(r).not.toBeNull()
    expect(r?.uncertain).toBe(true)
  })
  it('model categories become code-written reasons; ok and no answer hide nothing', () => {
    expect(verdictReason('threat')?.text).toBe(READER_REASON.threat)
    expect(verdictReason('ok')).toBeNull()
    expect(verdictReason(null)).toBeNull()
    expect(verdictReason(undefined)).toBeNull()
  })
  it('exact code patterns win over links, and links win over the model', () => {
    expect(hiddenReason('0971234567', 'threat')?.text).toContain('phone number')
    expect(hiddenReason('see www.x.com', 'threat')?.text).toContain('link')
    expect(hiddenReason('hello', 'threat')?.text).toBe(READER_REASON.threat)
  })
  it('every category has a reason and a "Possible ..." label', () => {
    for (const v of VERDICTS)
      if (v !== 'ok') {
        expect(READER_REASON[v].length).toBeGreaterThan(5)
        expect(READER_LABEL[v]).toMatch(/^Possible /)
      }
  })
  it('labels exact patterns and bare domains honestly', () => {
    expect(patternReason('0971234567')?.label).toBe('Possible personal information')
    expect(linkReason('paypa1-security-update.com')?.label).toBe('Possible link')
  })
  it('a long digit run is always hidden', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[1-9][0-9]{6,11}$/), (d) => {
        expect(hiddenReason(`ring ${d}`, 'ok')).not.toBeNull()
      }),
    )
  })
})
