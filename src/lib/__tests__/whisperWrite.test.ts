import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isOnline, runGuarded, WRITE_TIMEOUT_MS, WriteTimeoutError, withTimeout } from '../whisperWrite'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('isOnline', () => {
  it('is true when there is no navigator (Node, the emulator test)', () => {
    expect(isOnline(undefined)).toBe(true)
    vi.stubGlobal('navigator', undefined)
    expect(isOnline()).toBe(true)
  })
  it('is true when onLine is missing (Node 21+ has a navigator without onLine)', () => {
    expect(isOnline({})).toBe(true)
    expect(isOnline({ onLine: undefined })).toBe(true)
    vi.stubGlobal('navigator', { userAgent: 'Node.js/22' })
    expect(isOnline()).toBe(true)
  })
  it('follows onLine when the browser reports it', () => {
    expect(isOnline({ onLine: true })).toBe(true)
    expect(isOnline({ onLine: false })).toBe(false)
    vi.stubGlobal('navigator', { onLine: false })
    expect(isOnline()).toBe(false)
  })
})

describe('withTimeout', () => {
  it('clears its timer when the promise resolves', async () => {
    await expect(withTimeout(Promise.resolve(5), 10_000)).resolves.toBe(5)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('clears its timer when the promise rejects', async () => {
    await expect(withTimeout(Promise.reject(new Error('no')), 10_000)).rejects.toThrow('no')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects with WriteTimeoutError after the limit, and not before', async () => {
    let state = 'pending'
    const p = withTimeout(new Promise(() => {}), 10_000).catch((e) => {
      state = e instanceof WriteTimeoutError ? 'timeout' : 'other'
    })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(state).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(state).toBe('timeout')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('ignores a rejection that arrives after the timeout (no unhandled rejection)', async () => {
    let rejectLate: (e: Error) => void = () => {}
    const late = new Promise((_, rej) => {
      rejectLate = rej
    })
    const p = withTimeout(late, 1000).catch(() => 'timed out')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await p).toBe('timed out')
    rejectLate(new Error('late'))
    await vi.advanceTimersByTimeAsync(0)
  })
})

describe('runGuarded', () => {
  it('uses a 10 second limit', () => {
    expect(WRITE_TIMEOUT_MS).toBe(10_000)
  })

  it('offline: writes nothing and says generic', async () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    const r = await runGuarded(apply, { online: false })
    expect(apply).not.toHaveBeenCalled()
    expect(r).toEqual({ ok: false, code: 'generic', reason: 'offline' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('online and no navigator (Node): the write is attempted', async () => {
    vi.stubGlobal('navigator', undefined)
    const apply = vi.fn().mockResolvedValue(undefined)
    expect(await runGuarded(apply)).toEqual({ ok: true })
    expect(apply).toHaveBeenCalledOnce()
  })

  it('a commit that never settles gives generic after 10 s and not before', async () => {
    let done: unknown = null
    const p = runGuarded(() => new Promise(() => {})).then((r) => {
      done = r
    })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(done).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(done).toEqual({ ok: false, code: 'generic', reason: 'timeout' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a commit that settles clears its timer', async () => {
    expect(await runGuarded(() => Promise.resolve())).toEqual({ ok: true })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a rejected commit gives generic, carries the code for the console, and clears its timer', async () => {
    const r = await runGuarded(() => Promise.reject(Object.assign(new Error('x'), { code: 'permission-denied' })))
    expect(r).toEqual({ ok: false, code: 'generic', reason: 'permission-denied' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('property: any rejection is generic, and a commit is ok only if it settles inside the limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 30_000 }).filter((d) => d !== WRITE_TIMEOUT_MS),
        fc.boolean(),
        async (delay, shouldReject) => {
          const apply = () =>
            new Promise<void>((resolve, reject) => {
              setTimeout(() => (shouldReject ? reject(new Error('boom')) : resolve()), delay)
            })
          const p = runGuarded(apply)
          await vi.advanceTimersByTimeAsync(40_000)
          const r = await p
          if (shouldReject || delay > WRITE_TIMEOUT_MS) expect(r.ok).toBe(false)
          else expect(r.ok).toBe(true)
          if (!r.ok) expect(r.code).toBe('generic')
          vi.clearAllTimers()
        },
      ),
      { numRuns: 40 },
    )
  })
})
