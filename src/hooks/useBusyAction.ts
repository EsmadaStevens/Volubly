import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionResult } from '../lib/whisperApi'
import { whisperErrorText } from '../lib/whisperErrors'

export interface BusyAction {
  /** Label of the action in flight, or null. */
  busy: string | null
  /** Plain-language error from the last failed action, or null. */
  error: string | null
  /** True after an action succeeded. The row or card is about to go away, so its buttons stay off. */
  finished: boolean
  /** Runs one action. Returns null when ignored (one is already running, or the card is finished). */
  run: (label: string, action: () => Promise<ActionResult>) => Promise<ActionResult | null>
}

/**
 * Busy, error and finished state for a card or row with action buttons.
 * - A second tap while one action runs is ignored.
 * - Every action in whisperApi is bounded (offline check, 10 second limit), so `busy` always ends.
 * - Nothing is set after the component has unmounted.
 */
export function useBusyAction(): BusyAction {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const done = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(async (label: string, action: () => Promise<ActionResult>) => {
    if (inFlight.current || done.current) return null
    inFlight.current = true
    setBusy(label)
    setError(null)
    let result: ActionResult
    try {
      result = await action()
    } catch (err) {
      console.warn('Whisper action threw:', (err as { code?: string } | null)?.code)
      result = { ok: false, code: 'generic' }
    }
    inFlight.current = false
    if (result.ok) done.current = true
    if (mounted.current) {
      setBusy(null)
      if (result.ok) setFinished(true)
      else setError(whisperErrorText(result.code))
    }
    return result
  }, [])

  return { busy, error, finished, run }
}
