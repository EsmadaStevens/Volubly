import { containsLink } from './messageUtils'
import { FINDING_LABEL, redact } from './redact'
import type { Verdict } from './draftCheck'

/** Words for the reader. The model only picks the category; these sentences are written here. */
export const READER_REASON: Record<Exclude<Verdict, 'ok'>, string> = {
  harassment: 'This might be insulting or aimed at someone.',
  hate: 'This might be hateful toward a group of people.',
  threat: 'This might be a threat.',
  sexual: 'This might be too sexual for a public room.',
  personal_address: 'This might include where someone lives.',
}

/** Short category names shown as the title of a hidden message. "Possible" because a guess is involved. */
export const READER_LABEL: Record<Exclude<Verdict, 'ok'>, string> = {
  harassment: 'Possible harassment',
  hate: 'Possible hate-related language',
  threat: 'Possible threat',
  sexual: 'Possible sexual content',
  personal_address: 'Possible personal information',
}

export interface GuardReason {
  /** Category name, e.g. "Possible threat" or "Link found". */
  label: string
  /** One full sentence explaining why. */
  text: string
  /** True when a guess is involved, so the screen says "it may be wrong". */
  uncertain: boolean
}

const BARE_DOMAIN = /\b[a-z0-9][a-z0-9-]*\.(?:co\.za|co\.zm|com|net|org|co|io|app|xyz|info|link|biz|zm|me|ly)\b/i

/** Plain-code check, instant and on every device. Null means show normally. */
export function patternReason(body: string): GuardReason | null {
  const kinds = Array.from(new Set(redact(body).findings.map((f) => f.kind)))
  if (kinds.length === 0) return null
  return {
    label: 'Possible personal information',
    text: `It looks like it contains ${kinds.map((k) => FINDING_LABEL[k]).join(', ')}.`,
    uncertain: true,
  }
}

/** Links are never clickable here. They start hidden so nobody opens one by accident. */
export function linkReason(body: string): GuardReason | null {
  const explicit = containsLink(body)
  if (!explicit && !BARE_DOMAIN.test(body)) return null
  return {
    label: explicit ? 'Link found' : 'Possible link',
    text: "This message has a link. Links can't be opened from here, so make sure you trust it before you open it anywhere else.",
    uncertain: !explicit,
  }
}

export function verdictReason(verdict: Verdict | null | undefined): GuardReason | null {
  return verdict && verdict !== 'ok' ? { label: READER_LABEL[verdict], text: READER_REASON[verdict], uncertain: true } : null
}

/** Exact code patterns win; then links; then the model's category, if any. */
export function hiddenReason(body: string, verdict: Verdict | null | undefined): GuardReason | null {
  return patternReason(body) ?? linkReason(body) ?? verdictReason(verdict)
}
