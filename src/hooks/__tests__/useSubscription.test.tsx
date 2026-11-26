import { act, createElement, type MutableRefObject } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Emit, Open } from '../useSubscription'
import { useSubscription } from '../useSubscription'
import type { SubState } from '../../lib/whisperWatch'

// This file uses react-dom/client and act, not renderToStaticMarkup: static rendering never runs effects,
// and unsubscribing happens in an effect cleanup. jsdom is the project's test environment already.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface Opened {
  emit: Emit<number>
  unsub: ReturnType<typeof vi.fn>
}

function fakeSource() {
  const opened: Opened[] = []
  const open: Open<number> = (emit) => {
    const unsub = vi.fn()
    opened.push({ emit, unsub })
    return unsub
  }
  return { open, opened }
}

interface ProbeProps {
  open: Open<number> | null
  id: string
  log: Array<SubState<number>>
  retryRef: MutableRefObject<() => void>
}
function Probe({ open, id, log, retryRef }: ProbeProps) {
  const { state, retry } = useSubscription(open, [id])
  log.push(state)
  retryRef.current = retry
  return null
}

const last = <T,>(a: T[]): T => a[a.length - 1]

const roots: Array<() => void> = []
afterEach(() => {
  while (roots.length) roots.pop()!()
  vi.restoreAllMocks()
})

function mount(props: ProbeProps) {
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
  roots.push(unmount)
  act(() => root.render(createElement(Probe, props)))
  return {
    rerender: (next: Partial<ProbeProps>) => act(() => root.render(createElement(Probe, { ...props, ...next }))),
    unmount,
  }
}

const newProps = (open: Open<number> | null, id = 'a'): ProbeProps => ({
  open,
  id,
  log: [],
  retryRef: { current: () => {} },
})

describe('useSubscription', () => {
  it('opens one listener on mount, shows loading, then the data it is given', () => {
    const src = fakeSource()
    const p = newProps(src.open)
    mount(p)
    expect(src.opened).toHaveLength(1)
    expect(last(p.log)).toEqual({ status: 'loading' })
    act(() => src.opened[0].emit({ status: 'ready', data: 7 }))
    expect(last(p.log)).toEqual({ status: 'ready', data: 7 })
  })

  it('unsubscribes exactly once on unmount', () => {
    const src = fakeSource()
    const view = mount(newProps(src.open))
    expect(src.opened[0].unsub).not.toHaveBeenCalled()
    view.unmount()
    expect(src.opened[0].unsub).toHaveBeenCalledTimes(1)
    expect(src.opened).toHaveLength(1)
  })

  it('does not reopen when the component re-renders with the same deps, even with a new open function', () => {
    const src = fakeSource()
    const view = mount(newProps((emit) => src.open(emit)))
    view.rerender({ open: (emit) => src.open(emit) })
    view.rerender({ open: (emit) => src.open(emit) })
    expect(src.opened).toHaveLength(1)
    expect(src.opened[0].unsub).not.toHaveBeenCalled()
    view.unmount()
    expect(src.opened[0].unsub).toHaveBeenCalledTimes(1)
  })

  it('on a deps change unsubscribes the old listener once, opens a new one, and never shows the old data', () => {
    const src = fakeSource()
    const p = newProps(src.open, 'a')
    const view = mount(p)
    act(() => src.opened[0].emit({ status: 'ready', data: 1 }))
    const from = p.log.length
    view.rerender({ id: 'b' })
    expect(src.opened).toHaveLength(2)
    expect(src.opened[0].unsub).toHaveBeenCalledTimes(1)
    expect(src.opened[1].unsub).not.toHaveBeenCalled()
    // Every render after the change, including the very first one, is loading and never the old data.
    for (const s of p.log.slice(from)) expect(s).toEqual({ status: 'loading' })
    view.unmount()
    expect(src.opened[0].unsub).toHaveBeenCalledTimes(1)
    expect(src.opened[1].unsub).toHaveBeenCalledTimes(1)
  })

  it('drops a late snapshot after unmount: no state change and no React warning', () => {
    const src = fakeSource()
    const p = newProps(src.open)
    const view = mount(p)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const renders = p.log.length
    view.unmount()
    expect(() => act(() => src.opened[0].emit({ status: 'ready', data: 99 }))).not.toThrow()
    expect(p.log).toHaveLength(renders)
    expect(error).not.toHaveBeenCalled()
  })

  it('drops a late snapshot from a listener that a deps change already closed', () => {
    const src = fakeSource()
    const p = newProps(src.open, 'a')
    const view = mount(p)
    view.rerender({ id: 'b' })
    act(() => src.opened[0].emit({ status: 'ready', data: 111 })) // old listener answers late
    expect(last(p.log)).toEqual({ status: 'loading' })
    act(() => src.opened[1].emit({ status: 'ready', data: 222 }))
    expect(last(p.log)).toEqual({ status: 'ready', data: 222 })
  })

  it('open === null opens nothing and gives idle; switching to null closes the listener and drops the data', () => {
    const none = fakeSource()
    const idle = newProps(null)
    mount(idle)
    expect(none.opened).toHaveLength(0)
    expect(last(idle.log)).toEqual({ status: 'idle' })

    const src = fakeSource()
    const p = newProps(src.open)
    const view = mount(p)
    act(() => src.opened[0].emit({ status: 'ready', data: 5 }))
    view.rerender({ open: null })
    expect(src.opened[0].unsub).toHaveBeenCalledTimes(1)
    expect(last(p.log)).toEqual({ status: 'idle' })
  })

  it('retry closes the listener and opens a new one', () => {
    const src = fakeSource()
    const p = newProps(src.open)
    mount(p)
    act(() => src.opened[0].emit({ status: 'error', message: 'offline' }))
    expect(last(p.log)).toEqual({ status: 'error', message: 'offline' })
    act(() => p.retryRef.current())
    expect(src.opened).toHaveLength(2)
    expect(src.opened[0].unsub).toHaveBeenCalledTimes(1)
    expect(last(p.log)).toEqual({ status: 'loading' })
  })

  it('passes denied and error states through', () => {
    const src = fakeSource()
    const p = newProps(src.open)
    mount(p)
    act(() => src.opened[0].emit({ status: 'denied' }))
    expect(last(p.log)).toEqual({ status: 'denied' })
  })
})
