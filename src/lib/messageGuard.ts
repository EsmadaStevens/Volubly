import { containsLink } from './messageUtils'
import { FINDING_LABEL, redact } from './redact'
import type { Verdict } from './draftCheck'

/** Words for the reader. The model only picks the category; these sentences are written here. */
export const READER_REASON: Record<Exclude<Verdict, 'ok'>, string> = {
  harassment: 'this might be insulting or targeting someone',
  hate: 'this might be hateful toward a group of people',
  threat: 'this might be a threat',
  sexual: 'this might be too sexual for a public room',
  personal_address: 'this might include where someone lives',
}

export interface GuardReason {
  text: string
  /** True when a guess is involved, so the screen says "it may be wrong". */
  uncertain: boolean
}

const BARE_DOMAIN = /\b[a-z0-9][a-z0-9-]*\.(?:co\.za|co\.zm|com|net|org|co|io|app|xyz|info|link|biz|zm|me|ly)\b/i

/** Plain-code check, instant and on every device. Null means show normally. */
export function patternReason(body: string): GuardReason | null {
  const kinds = Array.from(new Set(redact(body).findings.map((f) => f.kind)))
  if (kinds.length === 0) return null
  return { text: `it looks like it contains ${kinds.map((k) => FINDING_LABEL[k]).join(', ')}`, uncertain: true }
}

/** Links are never clickable here. They start hidden so nobody opens one by accident. */
export function linkReason(body: string): GuardReason | null {
  const explicit = containsLink(body)
  if (!explicit && !BARE_DOMAIN.test(body)) return null
  return {
    text: "this message has a link. Links can't be opened from here, so make sure you trust it before you open it anywhere else",
    uncertain: !explicit,
  }
}

export function verdictReason(verdict: Verdict | null | undefined): GuardReason | null {
  return verdict && verdict !== 'ok' ? { text: READER_REASON[verdict], uncertain: true } : null
}

/** Exact code patterns win; then links; then the model's category, if any. */
export function hiddenReason(body: string, verdict: Verdict | null | undefined): GuardReason | null {
  return patternReason(body) ?? linkReason(body) ?? verdictReason(verdict)
}
