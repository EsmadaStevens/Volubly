import { getGenerativeModel, InferenceMode } from 'firebase/ai'
import { ai } from './firebase'
import type { DeviceState, GenerateResult } from './draftCheck'

// Say plainly that we send English text and expect English text back. Without this Chrome logs
// "No output language was specified", and it uses the language to attest to output safety.
const ON_DEVICE_PARAMS = {
  createOptions: {
    expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
    expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
  },
}

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
  const model = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams: ON_DEVICE_PARAMS })
  await model.initializeDeviceModel((p) => onProgress?.(p))
}

export async function generate(route: 'on_device' | 'cloud', prompt: string): Promise<GenerateResult> {
  const mode = route === 'on_device' ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.ONLY_IN_CLOUD
  const model =
    route === 'on_device'
      ? getGenerativeModel(ai, { mode, onDeviceParams: ON_DEVICE_PARAMS })
      : getGenerativeModel(ai, { mode })
  const result = await model.generateContent(prompt)
  return { text: result.response.text(), source: result.response.inferenceSource }
}
