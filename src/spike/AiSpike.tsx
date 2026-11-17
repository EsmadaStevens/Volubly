// Day-1 spike: does hybrid inference work on this machine, and does the SDK
// report which path ran? Temporary screen. Delete once the answers are in docs/build-log.md.
import { useState } from 'react'
import { getGenerativeModel, InferenceMode } from 'firebase/ai'
import { ai } from '../lib/firebase'

type Mode = (typeof InferenceMode)[keyof typeof InferenceMode]

const MODES: { label: string; mode: Mode }[] = [
  { label: 'Prefer on-device', mode: InferenceMode.PREFER_ON_DEVICE },
  { label: 'Only on-device', mode: InferenceMode.ONLY_ON_DEVICE },
  { label: 'Only cloud', mode: InferenceMode.ONLY_IN_CLOUD },
]

const DEFAULT_PROMPT =
  'You check a chat draft before it is sent. Reply with one word, SAFE or RISKY, ' +
  'then one short reason. Draft: "call me on 0977 123 456, I will send the money tonight"'

export default function AiSpike() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const add = (line: string) =>
    setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${line}`])

  async function checkAvailability() {
    const lm = (globalThis as { LanguageModel?: { availability(): Promise<string> } }).LanguageModel
    if (!lm) {
      add('Browser on-device API: not present (wrong browser, old Chrome, or flag off)')
      return
    }
    try {
      add(`Browser on-device API availability: ${await lm.availability()}`)
    } catch (e) {
      add(`Availability check failed: ${String(e)}`)
    }
  }

  async function prepareOnDevice() {
    setBusy(true)
    try {
      const model = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE })
      add('Preparing on-device model (may download, can take a long time)...')
      let last = -1
      await model.initializeDeviceModel((p) => {
        const pct = Math.floor(p * 100)
        if (pct !== last && pct % 5 === 0) {
          last = pct
          add(`Download ${pct}%`)
        }
      })
      add('On-device model ready')
    } catch (e) {
      add(`Prepare failed: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function run(label: string, mode: Mode) {
    setBusy(true)
    const started = performance.now()
    try {
      const model = getGenerativeModel(ai, { mode })
      const result = await model.generateContent(prompt)
      const ms = Math.round(performance.now() - started)
      const source = result.response.inferenceSource ?? 'not reported by SDK'
      add(`[${label}] source: ${source} | ${ms} ms | online: ${navigator.onLine}`)
      add(`   reply: ${result.response.text().trim()}`)
    } catch (e) {
      const ms = Math.round(performance.now() - started)
      add(`[${label}] FAILED after ${ms} ms | online: ${navigator.onLine} | ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const btn =
    'min-h-[44px] rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50'

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 text-slate-100">
      <h1 className="text-xl font-semibold">Volubly AI spike</h1>
      <textarea
        className="h-28 w-full rounded bg-slate-800 p-2 text-sm"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={busy} onClick={checkAvailability}>
          1. Check availability
        </button>
        <button className={btn} disabled={busy} onClick={prepareOnDevice}>
          2. Prepare on-device model
        </button>
        {MODES.map((m) => (
          <button key={m.label} className={btn} disabled={busy} onClick={() => run(m.label, m.mode)}>
            Run: {m.label}
          </button>
        ))}
        <button className={btn} onClick={() => navigator.clipboard.writeText(log.join('\n'))}>
          Copy log
        </button>
      </div>
      <pre className="min-h-[8rem] whitespace-pre-wrap rounded bg-slate-900 p-3 text-xs">
        {log.length ? log.join('\n') : 'Results appear here.'}
      </pre>
    </main>
  )
}
