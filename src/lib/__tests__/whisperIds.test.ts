import { afterEach, describe, expect, it, vi } from 'vitest'
import { newWhisperId } from '../whisperIds'

afterEach(() => vi.unstubAllGlobals())

describe('newWhisperId', () => {
  it('is letters and digits only, so it fits the #whisper/{id} route, and is different each time', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newWhisperId()))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{16,}$/)
  })

  it('still works when the browser has no randomUUID', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.map((_, i) => i * 7) })
    expect(newWhisperId()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('still works with no crypto at all', () => {
    vi.stubGlobal('crypto', undefined)
    expect(newWhisperId()).toMatch(/^[0-9a-f]{32}$/)
  })
})
