import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InferenceQueue, type Priority } from '../inferenceQueue'

const tick = () => new Promise((r) => setTimeout(r, 0))

/** A job we can finish by hand. */
function manual() {
  let done!: () => void
  const started = vi.fn()
  const run = () =>
    new Promise<string>((resolve) => {
      started()
      done = () => resolve('done')
    })
  return { run, started, finish: () => done() }
}

describe('InferenceQueue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs straight away when idle', async () => {
    const q = new InferenceQueue()
    const j = manual()
    const p = q.submit('read', j.run)
    expect(j.started).toHaveBeenCalledTimes(1)
    j.finish()
    expect(await p).toEqual({ ran: true, value: 'done' })
  })

  it('send goes before catch-up, which goes before read, whatever order they arrive', async () => {
    vi.useRealTimers()
    const q = new InferenceQueue()
    const order: Priority[] = []
    const first = manual()
    const p0 = q.submit('read', first.run)
    const mk = (p: Priority) => q.submit(p, async () => { order.push(p); return p })
    const reads = mk('read')
    const catchUp = mk('catch_up')
    const send = mk('send')
    first.finish()
    await Promise.all([p0, reads, catchUp, send])
    expect(order).toEqual(['send', 'catch_up', 'read'])
  })

  it('keeps arrival order within the same priority', async () => {
    vi.useRealTimers()
    const q = new InferenceQueue()
    const order: number[] = []
    const first = manual()
    const p0 = q.submit('send', first.run)
    const jobs = [1, 2, 3].map((n) => q.submit('send', async () => { order.push(n); return n }))
    first.finish()
    await Promise.all([p0, ...jobs])
    expect(order).toEqual([1, 2, 3])
  })

  it('a waiting reader check is skipped after its wait, and the model is not touched', async () => {
    const q = new InferenceQueue()
    const busy = manual()
    q.submit('send', busy.run)
    const late = vi.fn(async () => 'x')
    const p = q.submit('read', late, 5000)
    vi.advanceTimersByTime(5000)
    expect(await p).toEqual({ ran: false })
    busy.finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(late).not.toHaveBeenCalled()
    expect(q.depth).toBe(0)
  })

  it('reader checks cannot pile up: a full queue drops its oldest reader check', async () => {
    const q = new InferenceQueue(2)
    const busy = manual()
    q.submit('send', busy.run)
    const a = q.submit('read', async () => 'a')
    const b = q.submit('read', async () => 'b')
    const c = q.submit('read', async () => 'c')
    expect(await a).toEqual({ ran: false }) // oldest dropped
    expect(q.depth).toBe(2)
    busy.finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(await b).toEqual({ ran: true, value: 'b' })
    expect(await c).toEqual({ ran: true, value: 'c' })
  })

  it('does not drop send or catch-up jobs to make room for readers', async () => {
    const q = new InferenceQueue(1)
    const busy = manual()
    q.submit('read', busy.run)
    const send = q.submit('send', async () => 's')
    const r1 = q.submit('read', async () => 'r1')
    const r2 = q.submit('read', async () => 'r2')
    expect(await r1).toEqual({ ran: false })
    busy.finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(await send).toEqual({ ran: true, value: 's' })
    expect(await r2).toEqual({ ran: true, value: 'r2' })
  })

  it('carries on after a job that throws', async () => {
    vi.useRealTimers()
    const q = new InferenceQueue()
    const first = manual()
    const p0 = q.submit('send', first.run)
    const bad = q.submit('read', async () => { throw new Error('boom') })
    const good = q.submit('read', async () => 'ok')
    first.finish()
    await p0
    expect(await bad).toEqual({ ran: false })
    expect(await good).toEqual({ ran: true, value: 'ok' })
    await tick()
  })
})
