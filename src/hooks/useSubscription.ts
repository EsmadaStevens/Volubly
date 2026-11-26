import { useCallback, useEffect, useState } from 'react'
import type { Emit, SubState } from '../lib/whisperWatch'

export type { Emit, SubState } from '../lib/whisperWatch'

/** Opens a listener and returns the function that closes it. */
export type Open<T> = (emit: Emit<T>) => () => void

/**
 * The one place a whisper listener is opened and closed.
 *
 * - `open` is called in an effect. The function it returns is called when the component unmounts,
 *   when `deps` change, and when `retry` is used. Each opened listener is closed exactly once.
 * - A snapshot that arrives after its listener was closed is dropped.
 * - `open === null` opens nothing and gives `idle`. Anything held from an earlier listener is dropped.
 * - While `deps` have just changed and the new listener has not answered, the state is `loading`,
 *   never the old listener's data.
 *
 * `deps` must hold everything `open` uses (ids, flags). They are compared as text.
 */
export function useSubscription<T>(open: Open<T> | null, deps: readonly unknown[]): { state: SubState<T>; retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const key = `${deps.map(String).join('\u0000')}#${attempt}`
  const enabled = open !== null
  const [held, setHeld] = useState<{ key: string; state: SubState<T> }>(() => ({
    key,
    state: enabled ? { status: 'loading' } : { status: 'idle' },
  }))

  useEffect(() => {
    if (!open) {
      setHeld({ key, state: { status: 'idle' } })
      return
    }
    let cancelled = false
    setHeld({ key, state: { status: 'loading' } })
    const unsubscribe = open((state) => {
      if (!cancelled) setHeld({ key, state })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
    // `open` is rebuilt on every render; `key` and `enabled` say when it really changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const state: SubState<T> = held.key === key ? held.state : enabled ? { status: 'loading' } : { status: 'idle' }
  return { state, retry }
}
