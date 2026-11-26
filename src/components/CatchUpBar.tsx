import { useState, useSyncExternalStore } from 'react'
import { useProfiles } from '../hooks/useProfiles'
import { checkDeps } from '../lib/checkDeps'
import { SIM_PROFILES } from '../lib/demoData'
import { ON_DEVICE_LIMIT, planCatchUp, runCatchUp, takeLatest, tooFewMessage, tooFewToSummarise, type CatchUpItem, type CatchUpPlan } from '../lib/catchUp'
import { getInferenceSnapshot, subscribeInference } from '../lib/inferenceLog'
import type { GuardReason } from '../lib/messageGuard'
import type { MessageView } from '../types'

type Card =
  | { step: 'consent'; items: CatchUpItem[]; plan: CatchUpPlan }
  | { step: 'running'; label: string }
  | { step: 'done'; lines: string[]; where: string; secs: string; note: string }
  | { step: 'error'; message: string }

const btn = 'min-h-[44px] rounded-xl px-4 text-sm font-bold'

export default function CatchUpBar({
  unseen,
  hidden,
  held,
  onJump,
}: {
  unseen: MessageView[]
  hidden: Map<string, GuardReason>
  /** Messages the Delay Shield is still holding: left out so a summary can't spoil them. */
  held: Map<string, number>
  onJump: () => void
}) {
  const device = useSyncExternalStore(subscribeInference, getInferenceSnapshot).device
  const [card, setCard] = useState<Card | null>(null)
  // Usernames stay on this device: they are only used to put names back into the answer.
  const profiles = useProfiles(unseen.filter((m) => !m.simulated).map((m) => m.senderId))

  if (unseen.length === 0 && !card) return null

  async function run(route: 'on_device' | 'cloud', items: CatchUpItem[], reason: string, note: string) {
    setCard({ step: 'running', label: route === 'cloud' ? 'Summarising in the cloud...' : 'Summarising on this device...' })
    try {
      const r = await runCatchUp(route, items, reason, checkDeps)
      setCard({
        step: 'done',
        lines: r.lines,
        where: (r.path === 'unknown' ? route : r.path) === 'cloud' ? 'in the cloud' : 'on this device',
        secs: (r.ms / 1000).toFixed(1),
        note: r.covered < r.total ? `${note} Covers the latest ${r.covered} of ${r.total} new messages.`.trim() : note,
      })
    } catch (e) {
      setCard({ step: 'error', message: `Couldn't catch you up. ${(e as Error).message}` })
    }
  }

  function start() {
    // Messages already hidden on this device are left out. They are not sent anywhere.
    const items = unseen.filter((m) => !hidden.has(m.id) && !held.has(m.id)).map((m) => ({
        senderId: m.senderId,
        body: m.body,
        name: (m.simulated ? SIM_PROFILES[m.senderId] : profiles.get(m.senderId))?.username,
      }))
    if (items.length === 0) return setCard({ step: 'error', message: 'Nothing new to summarise.' })
    if (tooFewToSummarise(items.length)) return setCard({ step: 'error', message: tooFewMessage(items.length) })
    const plan = planCatchUp({ count: items.length, device, online: navigator.onLine })
    if (plan.kind === 'none') return setCard({ step: 'error', message: plan.reason })
    if (plan.kind === 'cloud') return setCard({ step: 'consent', items, plan })
    if (plan.kind === 'on_device_latest') return void run('on_device', takeLatest(items, ON_DEVICE_LIMIT), plan.reason, `Only the latest ${ON_DEVICE_LIMIT} messages were summarised.`)
    void run('on_device', items, plan.reason, '')
  }

  const close = () => setCard(null)

  return (
    <div className="space-y-2 px-3 pb-2">
      {card === null && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-raised px-3 py-1 shadow-lg">
          <p className="text-sm font-bold text-ink">
            {unseen.length} new {unseen.length === 1 ? 'message' : 'messages'}
          </p>
          <button type="button" onClick={onJump} className={`${btn} bg-surface text-spark`}>
            Jump to latest
          </button>
          <button type="button" onClick={start} className={`${btn} bg-accent text-night`}>
            Catch me up
          </button>
        </div>
      )}

      {card && (
        <section aria-label="Catch-up" className="space-y-2 rounded-2xl border border-line/60 bg-surface p-3 shadow-lg">
          {card.step === 'consent' && (
            <>
              <p className="text-sm font-bold text-ink">Use the cloud for this?</p>
              <p className="text-sm text-muted">
                {card.plan.reason} The messages would be sent to Google's Gemini through Firebase, with names replaced
                and phone numbers, emails, passwords and keys hidden.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void run('cloud', card.items, `${card.plan.reason} You allowed it.`, '')} className={`${btn} bg-accent text-night`}>
                  Send to cloud this time
                </button>
                {device === 'ready' && (
                  <button
                    type="button"
                    onClick={() => void run('on_device', takeLatest(card.items, ON_DEVICE_LIMIT), `You chose this device only. Latest ${ON_DEVICE_LIMIT} messages.`, `Only the latest ${ON_DEVICE_LIMIT} messages were summarised.`)}
                    className={`${btn} bg-raised text-ink`}
                  >
                    This device only
                  </button>
                )}
                <button type="button" onClick={close} className={`${btn} text-muted underline`}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {card.step === 'running' && <p className="text-sm text-ink">{card.label}</p>}

          {card.step === 'done' && (
            <>
              <p className="text-sm font-bold text-ink">While you were away</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
                {card.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
              <p className="text-xs text-muted">
                Summarised {card.where} in {card.secs} s. {card.note} AI summaries can be wrong.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => { close(); onJump() }} className={`${btn} bg-accent text-night`}>
                  Jump to latest
                </button>
                <button type="button" onClick={close} className={`${btn} bg-raised text-ink`}>
                  Close
                </button>
              </div>
            </>
          )}

          {card.step === 'error' && (
            <>
              <p role="alert" className="text-sm text-ink">{card.message}</p>
              <button type="button" onClick={close} className={`${btn} bg-raised text-ink`}>
                Close
              </button>
            </>
          )}
        </section>
      )}
    </div>
  )
}
