import type { Verdict } from './draftCheck'
import type { InferenceEvent, Outcome, Purpose, PurposeStats } from './inferenceLog'

const VERDICT_NAME: Record<Exclude<Verdict, 'ok'>, string> = {
  harassment: 'Harassment',
  hate: 'Hate',
  threat: 'Threat',
  sexual: 'Sexual content',
  personal_address: 'Personal address',
}

export const PURPOSE_NAME: Record<Purpose, string> = {
  send_check: 'Ghost-Mode',
  read_check: 'Reader protection',
  catch_up: 'Catch-up',
}

const CONTEXT: Record<Purpose, string> = {
  send_check: 'Sender check · Draft message',
  read_check: 'Incoming message · Local device check',
  catch_up: 'Catch-up request · Summary',
}

export function resultText(o: Outcome): string {
  switch (o.kind) {
    case 'verdict':
      return o.verdict === 'ok' ? 'Nothing flagged' : `${VERDICT_NAME[o.verdict]} flagged`
    case 'summary':
      return `Summary written (${o.points} ${o.points === 1 ? 'point' : 'points'})`
    case 'unavailable':
      return 'Not checked: no check was available'
    case 'timeout':
      return 'Not checked: timed out'
    case 'busy':
      return 'Not checked: the model was busy, plain-code protection still applied'
    case 'unclear':
      return 'Not checked: unclear answer from the model'
    case 'error':
      return 'Not checked: the check failed'
  }
}

export function whenText(at: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - at) / 1000))
  if (s < 10) return 'Just now'
  if (s < 60) return 'A moment ago'
  return `${Math.round(s / 60)} min ago`
}

export function durationText(ms: number | null): string | null {
  if (ms === null) return null
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function routeName(e: InferenceEvent): string {
  if (e.route === 'skipped') return 'Skipped'
  if (e.path === 'on_device') return 'On-device'
  if (e.path === 'cloud') return 'Cloud'
  // The SDK did not say which ran, but we only ever ask for ONLY_ON_DEVICE or ONLY_IN_CLOUD, which cannot
  // fall back to the other one. So the route we asked for is the route that ran (or would have run).
  return e.route === 'cloud' ? 'Cloud' : 'On-device'
}

export interface EventView {
  route: string
  purpose: string
  when: string
  duration: string | null
  context: string
  result: string
  why: string
  notChecked: boolean
}

export function describeEvent(e: InferenceEvent, nowMs: number): EventView {
  return {
    route: routeName(e),
    purpose: PURPOSE_NAME[e.purpose],
    when: whenText(e.at, nowMs),
    duration: durationText(e.ms),
    context: CONTEXT[e.purpose],
    result: resultText(e.outcome),
    why: e.reason,
    notChecked: !(e.outcome.kind === 'verdict' || e.outcome.kind === 'summary'),
  }
}

export function statsText(s: PurposeStats): string {
  const done = s.onDevice + s.cloud
  const parts = [`${done} completed (${s.onDevice} on-device, ${s.cloud} cloud)`]
  parts.push(`${s.notChecked} not checked${s.timedOut ? ` (${s.timedOut} timed out)` : ''}`)
  if (s.flagged) parts.push(`${s.flagged} flagged`)
  const avg = (sum: number, n: number) => (n ? durationText(sum / n) : null)
  const a = avg(s.msOnDevice, s.onDevice)
  const c = avg(s.msCloud, s.cloud)
  if (a) parts.push(`avg on-device ${a}`)
  if (c) parts.push(`avg cloud ${c}`)
  return parts.join(' · ')
}
