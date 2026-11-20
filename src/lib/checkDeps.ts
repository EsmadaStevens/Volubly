import { generate } from './ai'
import type { CheckDeps } from './draftCheck'
import { InferenceQueue } from './inferenceQueue'
import { recordInference } from './inferenceLog'

// One queue for the one on-device model, shared by sending, reading and catch-up.
const queue = new InferenceQueue()

// The first on-device call after the page loads has to wake a large model and can take
// ten seconds or more. After that it takes about a second. So allow longer only once.
let onDeviceWarm = false

export const checkDeps: CheckDeps = {
  async generate(route, prompt) {
    const res = await generate(route, prompt)
    if (route === 'on_device') onDeviceWarm = true
    return res
  },
  now: () => Date.now(),
  record: recordInference,
  schedule: (priority, run, maxWaitMs) => queue.submit(priority, run, maxWaitMs),
  get timeoutMs() {
    return { on_device: onDeviceWarm ? 6000 : 15000, cloud: 8000 }
  },
}
