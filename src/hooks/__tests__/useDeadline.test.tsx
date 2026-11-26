import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCountdown, useDeadline } from '../useCountdown'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const T0 = 1_800_000_000_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function mount(node: () => ReturnType<typeof createElement>) {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  act(() => root.render(node()))
  return {
    text: () => el.textContent,
    rerender: (n: ReturnType<typeof createElement>) => act(() => root.render(n)),
    unmount: () => {
      act(() => root.unmount())
      el.remove()
    },
  }
}

function Deadline({ end }: { end: number }) {
  return createElement('span', null, String(useDeadline(end)))
}
function Countdown({ end }: { end: number }) {
  return createElement('span', null, String(useCountdown(end)))
}

describe('useDeadline', () => {
  it('flips once, at the end and not before', () => {
    const v = mount(() => createElement(Deadline, { end: T0 + 5000 }))
    expect(v.text()).toBe('false')
    act(() => void vi.advanceTimersByTime(4999))
    expect(v.text()).toBe('false')
    act(() => void vi.advanceTimersByTime(1))
    expect(v.text()).toBe('true')
    v.unmount()
  })

  it('is true at once when the end has already passed', () => {
    const v = mount(() => createElement(Deadline, { end: T0 - 1 }))
    expect(v.text()).toBe('true')
    v.unmount()
  })

  it('catches up when the page becomes visible again after the device slept (timer never fired)', () => {
    const v = mount(() => createElement(Deadline, { end: T0 + 60_000 }))
    expect(v.text()).toBe('false')
    // The clock jumps past the end while no timer runs, like a laptop that went to sleep.
    vi.setSystemTime(T0 + 61_000)
    expect(v.text()).toBe('false')
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(v.text()).toBe('true')
    v.unmount()
  })

  it('catches up when the window gets focus', () => {
    const v = mount(() => createElement(Deadline, { end: T0 + 60_000 }))
    vi.setSystemTime(T0 + 90_000)
    act(() => void window.dispatchEvent(new Event('focus')))
    expect(v.text()).toBe('true')
    v.unmount()
  })

  it('a visibility or focus event before the end changes nothing', () => {
    const v = mount(() => createElement(Deadline, { end: T0 + 60_000 }))
    vi.setSystemTime(T0 + 30_000)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    expect(v.text()).toBe('false')
    v.unmount()
  })

  it('removes its timer and both listeners on unmount', () => {
    const docRemove = vi.spyOn(document, 'removeEventListener')
    const winRemove = vi.spyOn(window, 'removeEventListener')
    const v = mount(() => createElement(Deadline, { end: T0 + 60_000 }))
    expect(vi.getTimerCount()).toBe(1)
    v.unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(docRemove.mock.calls.some(([type]) => type === 'visibilitychange')).toBe(true)
    expect(winRemove.mock.calls.some(([type]) => type === 'focus')).toBe(true)
    // Events after unmount are harmless.
    expect(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    }).not.toThrow()
  })

  it('leaves no timer behind once it has flipped', () => {
    const v = mount(() => createElement(Deadline, { end: T0 + 1000 }))
    act(() => void vi.advanceTimersByTime(1000))
    expect(v.text()).toBe('true')
    expect(vi.getTimerCount()).toBe(0)
    v.unmount()
  })

  it('a new, later end time starts counting again', () => {
    const v = mount(() => createElement(Deadline, { end: T0 - 1 }))
    expect(v.text()).toBe('true')
    v.rerender(createElement(Deadline, { end: T0 + 10_000 }))
    expect(v.text()).toBe('false')
    v.unmount()
  })
})

describe('useCountdown', () => {
  it('counts down each second and stops at zero', () => {
    const v = mount(() => createElement(Countdown, { end: T0 + 3000 }))
    expect(v.text()).toBe('3000')
    act(() => void vi.advanceTimersByTime(1000))
    expect(v.text()).toBe('2000')
    act(() => void vi.advanceTimersByTime(5000))
    expect(v.text()).toBe('0')
    expect(vi.getTimerCount()).toBe(0)
    v.unmount()
  })

  it('clears its interval on unmount', () => {
    const v = mount(() => createElement(Countdown, { end: T0 + 60_000 }))
    expect(vi.getTimerCount()).toBe(1)
    v.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows zero, with no timer, when the end has passed', () => {
    const v = mount(() => createElement(Countdown, { end: T0 - 5000 }))
    expect(v.text()).toBe('0')
    expect(vi.getTimerCount()).toBe(0)
    v.unmount()
  })
})
