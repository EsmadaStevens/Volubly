import type { DeviceState, Verdict } from './draftCheck'

/** Where the SDK says it ran. 'unknown' = the SDK did not say, so we do not claim either. */
export type InferencePath = 'on_device' | 'cloud' | 'none' | 'unknown'
export type Purpose = 'send_check' | 'read_check' | 'catch_up'
export type Trigger = 'send_click' | 'incoming_message' | 'catch_up_request'
/** What we asked for. Compare with `path`, which is what actually ran. */
export type Route = 'on_device' | 'cloud' | 'skipped'

/**
 * What came out. Only the classifier's label or a count is kept, never the message text,
 * the draft, or the summary. The log is for explaining what the app did, not for remembering
 * what anyone wrote.
 */
export type Outcome =
  | { kind: 'verdict'; verdict: Verdict }
  | { kind: 'summary'; points: number }
  | { kind: 'unavailable' } // no route: no model ready, offline, or no consent
  | { kind: 'timeout' }
  | { kind: 'busy' } // the on-device model was busy with something more important
  | { kind: 'unclear' } // the model answered, but not with an allowed label
  | { kind: 'error' }

export interface InferenceEvent {
  at: number
  purpose: Purpose
  trigger: Trigger
  route: Route
  path: InferencePath
  ms: number | null
  /** Why the check ran this way. Written in code, never contains user text. */
  reason: string
  outcome: Outcome
}

/** A check "completed" only if it produced a label or a summary. A timeout is not a safety check. */
export const isCompleted = (o: Outcome) => o.kind === 'verdict' || o.kind === 'summary'
export const isFlagged = (o: Outcome) => o.kind === 'verdict' && o.verdict !== 'ok'

export interface PurposeStats {
  onDevice: number
  cloud: number
  unknown: number
  /** Did not produce a result: unavailable, timed out, busy, unclear or error. */
  notChecked: number
  timedOut: number
  flagged: number
  msOnDevice: number
  msCloud: number
}

const emptyStats = (): PurposeStats => ({
  onDevice: 0, cloud: 0, unknown: 0, notChecked: 0, timedOut: 0, flagged: 0, msOnDevice: 0, msCloud: 0,
})

export interface InferenceSnapshot {
  device: DeviceState
  /** Newest last, at most 20. The counts below cover the whole session. */
  events: InferenceEvent[]
  stats: Record<Purpose, PurposeStats>
}

const fresh = (): InferenceSnapshot => ({
  device: 'unknown',
  events: [],
  stats: { send_check: emptyStats(), read_check: emptyStats(), catch_up: emptyStats() },
})

let snapshot: InferenceSnapshot = fresh()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const subscribeInference = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
export const getInferenceSnapshot = () => snapshot

export function recordInference(e: InferenceEvent) {
  const s = { ...snapshot.stats[e.purpose] }
  if (isCompleted(e.outcome)) {
    if (e.path === 'on_device') {
      s.onDevice++
      s.msOnDevice += e.ms ?? 0
    } else if (e.path === 'cloud') {
      s.cloud++
      s.msCloud += e.ms ?? 0
    } else s.unknown++
  } else {
    s.notChecked++
    if (e.outcome.kind === 'timeout') s.timedOut++
  }
  if (isFlagged(e.outcome)) s.flagged++
  snapshot = {
    ...snapshot,
    events: [...snapshot.events, e].slice(-20),
    stats: { ...snapshot.stats, [e.purpose]: s },
  }
  emit()
}

export function setDeviceState(device: DeviceState) {
  if (snapshot.device === device) return
  snapshot = { ...snapshot, device }
  emit()
}

/** For tests. */
export function resetInferenceLog() {
  snapshot = fresh()
  emit()
}
