import { generate } from './ai'
import type { CheckDeps } from './draftCheck'
import { InferenceQueue } from './inferenceQueue'
import { recordInference } from './inferenceLog'
import { isCold, onDeviceTimeout } from './warmth'
import { setWarming } from './warmingState'

// One queue for the one on-device model, shared by sending, reading and catch-up.
const queue = new InferenceQueue()

// When an on-device call last finished OK on this page. A call after a long quiet spell has to
// wake the model again, so it gets the longer allowance; a warm call gets the short one.
let lastOnDeviceAt: number | null = null
let warming = false

export const checkDeps: CheckDeps = {
  async generate(route, prompt) {
    const res = await generate(route, prompt)
    if (route === 'on_device') lastOnDeviceAt = Date.now()
    return res
  },
  now: () => Date.now(),
  record: recordInference,
  schedule: (priority, run, maxWaitMs) => queue.submit(priority, run, maxWaitMs),
  get timeoutMs() {
    return { on_device: onDeviceTimeout(lastOnDeviceAt, Date.now()), cloud: 8000 }
  },
}

export function onDeviceIsCold(): boolean {
  return isCold(lastOnDeviceAt, Date.now())
}

/**
 * Wakes the on-device model with a tiny prompt so the person's real check is fast.
 * It runs on this device only, carries no message text, is not counted in the inference
 * activity, and steps aside (is skipped) if a real check already has the model.
 */
export async function warmOnDevice(): Promise<void> {
  if (warming || !onDeviceIsCold()) return
  warming = true
  setWarming(true)
  try {
    await queue.submit('read', () => generate('on_device', 'Reply with the single word: ok'), 1).then((r) => {
      if (r.ran) lastOnDeviceAt = Date.now()
    })
  } catch {
    /* warming is best effort */
  } finally {
    warming = false
    setWarming(false)
  }
}
