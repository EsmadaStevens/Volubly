import { getGenerativeModel, InferenceMode } from 'firebase/ai'
import { ai } from './firebase'
import type { DeviceState, GenerateResult } from './draftCheck'

type LanguageModelApi = { availability(): Promise<string> }

/** What this browser says about its built-in model. Desktop Chrome with the flag on only. */
export async function deviceAvailability(): Promise<DeviceState> {
  const lm = (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel
  if (!lm) return 'unavailable'
  try {
    const a = await lm.availability()
    if (a === 'available') return 'ready'
    if (a === 'downloadable') return 'downloadable'
    if (a === 'downloading') return 'downloading'
    return 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/** Must be called from a click or key press. May download a very large model. */
export async function prepareDevice(onProgress?: (fraction: number) => void): Promise<void> {
  const model = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE })
  await model.initializeDeviceModel((p) => onProgress?.(p))
}

export async function generate(route: 'on_device' | 'cloud', prompt: string): Promise<GenerateResult> {
  const mode = route === 'on_device' ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.ONLY_IN_CLOUD
  const model = getGenerativeModel(ai, { mode })
  const result = await model.generateContent(prompt)
  return { text: result.response.text(), source: result.response.inferenceSource }
}
