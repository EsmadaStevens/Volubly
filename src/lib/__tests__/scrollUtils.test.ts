import { describe, expect, it } from 'vitest'
import { messagesAfter } from '../scrollUtils'

const msgs = (ids: string[]) => ids.map((id) => ({ id }))

describe('messagesAfter', () => {
  it('returns what came after the last seen message', () => {
    expect(messagesAfter(msgs(['a', 'b', 'c', 'd']), 'b')).toEqual(msgs(['c', 'd']))
  })

  it('returns nothing when the reader has seen the last one, or has no anchor yet', () => {
    expect(messagesAfter(msgs(['a', 'b']), 'b')).toEqual([])
    expect(messagesAfter(msgs(['a', 'b']), null)).toEqual([])
  })

  it('returns everything still loaded when the anchor has slid out of the window', () => {
    expect(messagesAfter(msgs(['x', 'y', 'z']), 'gone')).toEqual(msgs(['x', 'y', 'z']))
  })
})
