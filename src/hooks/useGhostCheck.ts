import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { deviceAvailability, prepareDevice } from '../lib/ai'
import { checkDeps } from '../lib/checkDeps'
import { checkDraft, chooseRoute, planSend, type CheckResult, type Plan } from '../lib/draftCheck'
import { getInferenceSnapshot, setDeviceState, subscribeInference } from '../lib/inferenceLog'
import { redact, type Redaction } from '../lib/redact'

const CONSENT_KEY = 'volubly.cloudCheckConsent'
let warmed = false

function readConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'yes'
  } catch {
    return false
  }
}

export interface Review {
  plan: Plan
  check: CheckResult
  redaction: Redaction
}

export function useGhostCheck() {
  const snap = useSyncExternalStore(subscribeInference, getInferenceSnapshot)
  const [cloudConsent, setConsentState] = useState(readConsent)
  const [progress, setProgress] = useState<number | null>(null)
  const latest = useRef({ device: snap.device, cloudConsent })
  latest.current = { device: snap.device, cloudConsent }

  const refresh = useCallback(async () => setDeviceState(await deviceAvailability()), [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // While the browser is downloading its model, keep checking until it is ready.
  useEffect(() => {
    if (snap.device !== 'downloading') return
    const t = setInterval(() => void refresh(), 3000)
    return () => clearInterval(t)
  }, [snap.device, refresh])

  const setCloudConsent = useCallback((on: boolean) => {
    setConsentState(on)
    try {
      localStorage.setItem(CONSENT_KEY, on ? 'yes' : 'no')
    } catch {
      /* private window: the choice just won't be remembered */
    }
  }, [])

  /** Click handler: may start a very large download, so it is only ever started by the person. */
  const turnOnDevice = useCallback(async () => {
    setProgress(0)
    try {
      await prepareDevice((p) => setProgress(Math.floor(p * 100)))
    } catch (e) {
      console.warn('On-device preparation failed', e)
    }
    setProgress(null)
    await refresh()
  }, [refresh])

  /** Cheap warm-up when the model is already on this device. Needs a user gesture, so call from focus/typing. */
  const warm = useCallback(() => {
    if (warmed || latest.current.device !== 'ready') return
    warmed = true
    prepareDevice().catch(() => {
      warmed = false
    })
  }, [])

  const review = useCallback(async (draft: string): Promise<Review> => {
    // 1. Plain-code redaction first: nothing sensitive can reach any model, local or cloud.
    const redaction = redact(draft)
    // 2. Then the model flags (and only flags).
    const route = chooseRoute({
      device: latest.current.device,
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      cloudConsent: latest.current.cloudConsent,
    })
    const check = await checkDraft(redaction.redacted, route, checkDeps)
    return { plan: planSend({ draft, redaction, verdict: check.verdict }), check, redaction }
  }, [])

  return { snap, cloudConsent, setCloudConsent, progress, turnOnDevice, warm, review }
}

export type GhostCheck = ReturnType<typeof useGhostCheck>
