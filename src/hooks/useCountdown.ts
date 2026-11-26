import { useEffect, useState } from 'react'
import { deadlinePassed } from '../lib/whisperTime'

// The longest a browser timer can wait. The real wait here is at most one hour.
const MAX_TIMER_MS = 2_000_000_000

/** Milliseconds left until `endMs`, updated every second. For the small countdown chip only. */
export function useCountdown(endMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  const over = deadlinePassed(endMs, now)
  useEffect(() => {
    setNow(Date.now())
    if (deadlinePassed(endMs, Date.now())) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [endMs, over])
  return Math.max(0, endMs - now)
}

/**
 * True once `endMs` has passed. Flips once. A single timer fires late after the device sleeps or a
 * background tab is throttled, so the clock is also re-read when the page becomes visible again and
 * when the window gets focus. Timer and listeners are removed on unmount.
 */
export function useDeadline(endMs: number): boolean {
  const [flippedFor, setFlippedFor] = useState<number | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      if (deadlinePassed(endMs, Date.now())) {
        setFlippedFor(endMs)
        return
      }
      // Timers do not fire early, but if one did, wait again instead of giving up.
      clearTimeout(timer)
      timer = setTimeout(check, Math.min(MAX_TIMER_MS, Math.max(0, endMs - Date.now())))
    }
    check()
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [endMs])
  // Read the clock on every render as well, so a re-render after the end never shows the old answer.
  return flippedFor === endMs || deadlinePassed(endMs, Date.now())
}
