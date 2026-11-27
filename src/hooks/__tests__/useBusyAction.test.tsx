import { act, createElement, type MutableRefObject } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionResult } from '../../lib/whisperApi'
import { GENERIC_ERROR_TEXT, TOO_MANY_TEXT } from '../../lib/whisperCopy'
import { useBusyAction, type BusyAction } from '../useBusyAction'

// Effects and state updates matter here (the unmount guard), so this uses react-dom/client and act.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Probe({ api }: { api: MutableRefObject<BusyAction | null> }) {
  api.current = useBusyAction()
  return null
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
  vi.restoreAllMocks()
})

function mount() {
  const api: MutableRefObject<BusyAction | null> = { current: null }
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  let mounted = true
  const unmount = () => {
    if (!mounted) return
    mounted = false
    act(() => root.unmount())
    el.remove()
  }
  cleanups.push(unmount)
  act(() => root.render(createElement(Probe, { api })))
  return { api, unmount }
}

const deferred = () => {
  let resolve!: (r: ActionResult) => void
  const promise = new Promise<ActionResult>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('useBusyAction', () => {
  it('starts idle', () => {
    const { api } = mount()
    expect(api.current).toMatchObject({ busy: null, error: null, finished: false })
  })

  it('shows the label while the action runs, then finishes on success', async () => {
    const { api } = mount()
    const d = deferred()
    let p!: Promise<ActionResult | null>
    act(() => {
      p = api.current!.run('accept', () => d.promise)
    })
    expect(api.current!.busy).toBe('accept')
    await act(async () => {
      d.resolve({ ok: true })
      await p
    })
    expect(api.current).toMatchObject({ busy: null, error: null, finished: true })
    await expect(p).resolves.toEqual({ ok: true })
  })

  it('a failure clears busy, shows the plain error, and does not finish', async () => {
    const { api } = mount()
    await act(async () => {
      await api.current!.run('decline', async () => ({ ok: false, code: 'generic' }))
    })
    expect(api.current).toMatchObject({ busy: null, error: GENERIC_ERROR_TEXT, finished: false })
  })

  it('the too-many message is shown as is', async () => {
    const { api } = mount()
    await act(async () => {
      await api.current!.run('accept', async () => ({ ok: false, code: 'too_many' }))
    })
    expect(api.current!.error).toBe(TOO_MANY_TEXT)
  })

  it('an action that throws is treated as the generic failure, and busy still ends', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { api } = mount()
    await act(async () => {
      await api.current!.run('accept', async () => {
        throw new Error('boom')
      })
    })
    expect(api.current).toMatchObject({ busy: null, error: GENERIC_ERROR_TEXT, finished: false })
  })

  it('a retry after a failure clears the old error while it runs', async () => {
    const { api } = mount()
    await act(async () => {
      await api.current!.run('accept', async () => ({ ok: false, code: 'generic' }))
    })
    expect(api.current!.error).not.toBeNull()
    const d = deferred()
    act(() => void api.current!.run('accept', () => d.promise))
    expect(api.current!.error).toBeNull()
    await act(async () => d.resolve({ ok: true }))
  })

  it('ignores a second tap while one action is running', async () => {
    const { api } = mount()
    const d = deferred()
    const first = vi.fn(() => d.promise)
    const second = vi.fn(async (): Promise<ActionResult> => ({ ok: true }))
    let secondResult: ActionResult | null | undefined
    act(() => void api.current!.run('accept', first))
    await act(async () => {
      secondResult = await api.current!.run('decline', second)
    })
    expect(second).not.toHaveBeenCalled()
    expect(secondResult).toBeNull()
    await act(async () => d.resolve({ ok: true }))
  })

  it('ignores further actions once finished', async () => {
    const { api } = mount()
    await act(async () => void (await api.current!.run('accept', async () => ({ ok: true }))))
    const again = vi.fn(async (): Promise<ActionResult> => ({ ok: true }))
    await act(async () => void (await api.current!.run('decline', again)))
    expect(again).not.toHaveBeenCalled()
  })

  it('sets nothing after unmount (no React warning)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { api, unmount } = mount()
    const d = deferred()
    let p!: Promise<ActionResult | null>
    act(() => {
      p = api.current!.run('accept', () => d.promise)
    })
    unmount()
    await act(async () => {
      d.resolve({ ok: false, code: 'generic' })
      await p
    })
    expect(error).not.toHaveBeenCalled()
  })
})
