import { useCallback, useEffect, useState } from 'react'
import { holdMsLeft, isSpoilerLike, parseDelay, type DelaySecs } from '../lib/spoiler'
import type { MessageView } from '../types'

const KEY = 'volubly.delaySecs'

export function useDelaySetting(): [DelaySecs, (d: DelaySecs) => void] {
  const [secs, setSecsState] = useState<DelaySecs>(() => {
    try {
      return parseDelay(localStorage.getItem(KEY))
    } catch {
      return 0
    }
  })
  const setSecs = useCallback((d: DelaySecs) => {
    setSecsState(d)
    try {
      localStorage.setItem(KEY, String(d))
    } catch {
      /* private window: just not remembered */
    }
  }, [])
  return [secs, setSecs]
}

/**
 * Which other-people messages are still being held back, and for how long.
 * Ticks once a second, but only while something is actually held.
 */
export function useDelayShield(messages: MessageView[], uid: string, delaySecs: DelaySecs): Map<string, number> {
  const [now, setNow] = useState(() => Date.now())

  const compute = (at: number) => {
    const out = new Map<string, number>()
    if (delaySecs === 0) return out
    for (const m of messages) {
      if (m.senderId === uid || !isSpoilerLike(m.body)) continue
      const left = holdMsLeft(m.sentAtMs, at, delaySecs)
      if (left > 0) out.set(m.id, left)
    }
    return out
  }

  const held = compute(now)
  const anyHeld = held.size > 0

  useEffect(() => {
    if (!anyHeld) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [anyHeld])

  // New messages or a new setting: refresh the clock straight away.
  useEffect(() => {
    setNow(Date.now())
  }, [messages.length, delaySecs])

  return held
}
