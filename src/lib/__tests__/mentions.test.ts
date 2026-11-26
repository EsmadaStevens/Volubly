import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { completeMention, mentionQuery, mentionsMe, splitMentions, suggestNames } from '../mentions'

describe('mentionQuery', () => {
  it('finds an @ at the start or after a space, up to the caret', () => {
    expect(mentionQuery('@ze', 3)).toEqual({ start: 0, query: 'ze' })
    expect(mentionQuery('hi @', 4)).toEqual({ start: 3, query: '' })
    expect(mentionQuery('hi @Ab_1', 8)).toEqual({ start: 3, query: 'Ab_1' })
  })
  it('ignores emails, finished words and a caret elsewhere', () => {
    expect(mentionQuery('a@b', 3)).toBeNull()
    expect(mentionQuery('@zed hello', 10)).toBeNull()
    expect(mentionQuery('hello', 5)).toBeNull()
    expect(mentionQuery('@zed hello', 2)).toEqual({ start: 0, query: 'z' })
  })
})

describe('suggestNames', () => {
  const names = ['Zed', 'zara', 'Mazi', 'Kay', 'Zed']
  it('puts prefix matches first, ignores case, de-duplicates and leaves out yourself', () => {
    expect(suggestNames(names, 'z', undefined)).toEqual(['Zed', 'zara', 'Mazi'])
    expect(suggestNames(names, 'z', 'zed')).toEqual(['zara', 'Mazi'])
  })
  it('shows everyone for a bare @, capped', () => {
    expect(suggestNames(['a1', 'b1', 'c1', 'd1', 'e1', 'f1'], '', undefined)).toHaveLength(5)
    expect(suggestNames(names, 'qq', undefined)).toEqual([])
  })
})

describe('completeMention', () => {
  it('replaces the partial mention and moves the caret after it', () => {
    const q = mentionQuery('hey @ze there', 7)!
    expect(completeMention('hey @ze there', q, 7, 'Zed', 280)).toEqual({ text: 'hey @Zed there', cursor: 9 })
    const q2 = mentionQuery('@ze', 3)!
    expect(completeMention('@ze', q2, 3, 'Zed', 280)).toEqual({ text: '@Zed ', cursor: 5 })
  })
  it('refuses when it would not fit', () => {
    const q = mentionQuery('@z', 2)!
    expect(completeMention('@z', q, 2, 'Zed', 4)).toBeNull()
  })
})

describe('splitMentions', () => {
  it('highlights known names only, and marks the reader', () => {
    const s = splitMentions('hi @Zed and @nobody, @kay!', ['Zed', 'Kay'], 'kay')
    expect(s.filter((x) => x.mention).map((x) => [x.text, x.me])).toEqual([['@Zed', false], ['@kay', true]])
    expect(s.map((x) => x.text).join('')).toBe('hi @Zed and @nobody, @kay!')
  })
  it('does not treat an email as a mention', () => {
    expect(splitMentions('mail a@Zed.com', ['Zed']).some((x) => x.mention)).toBe(false)
  })
  it('mentionsMe is false without a name', () => {
    expect(mentionsMe('@Zed hi', ['Zed'], undefined)).toBe(false)
    expect(mentionsMe('@zed hi', ['Zed'], 'Zed')).toBe(true)
  })
  it('the pieces always join back into the original text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (body) => {
        expect(splitMentions(body, ['Zed', 'a'], 'a').map((x) => x.text).join('')).toBe(body)
      }),
    )
  })
})
