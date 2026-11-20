import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { checkDraft, type Verdict } from '../lib/draftCheck'
import { checkDeps } from '../lib/checkDeps'
import { getInferenceSnapshot, subscribeInference } from '../lib/inferenceLog'
import { hiddenReason, linkReason, patternReason, type GuardReason } from '../lib/messageGuard'
import type { MessageView } from '../types'

// What this device's model said about each message id. null = skipped or no answer.
// It lives for the whole session, so each message is judged at most once.
const verdicts = new Map<string, Verdict | null>()
const MAX_AI_CHECKS_PER_PASS = 30

/**
 * Decides, on THIS device, which messages from other people to hide by default.
 * - Plain-code patterns (phone numbers, emails, passwords, keys) work on every device.
 * - The AI category check runs only if this browser's own model is ready. Other people's
 *   messages are never sent to the cloud for this.
 * Returns message id -> reason, for messages that should start hidden.
 */
export function useMessageGuard(messages: MessageView[], uid: string): Map<string, GuardReason> {
  const device = useSyncExternalStore(subscribeInference, getInferenceSnapshot).device
  const [, bump] = useState(0)
  const idsKey = messages.map((m) => m.id).join(',')

  useEffect(() => {
    if (device !== 'ready') return
    let cancelled = false
    const todo = messages
      .filter((m) => m.senderId !== uid && !verdicts.has(m.id) && patternReason(m.body) === null && linkReason(m.body) === null)
      .slice(-MAX_AI_CHECKS_PER_PASS)
      .reverse() // newest first
    void (async () => {
      for (const m of todo) {
        if (cancelled) return
        const r = await checkDraft(m.body, { use: 'on_device' }, checkDeps, 'read_check')
        verdicts.set(m.id, r.verdict)
        bump((n) => n + 1)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, device, uid])

  return useMemo(() => {
    const out = new Map<string, GuardReason>()
    for (const m of messages) {
      if (m.senderId === uid) continue // never hide your own messages from yourself
      const reason = hiddenReason(m.body, verdicts.get(m.id))
      if (reason) out.set(m.id, reason)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, uid, verdicts.size])
}
