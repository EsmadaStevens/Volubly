/**
 * Delay Shield: people watching a stream are often 30 to 90 seconds behind the live match.
 * A message that gives away what just happened is held back on their screen until their own
 * delay has passed. Plain code, no AI, works on every device. It is a keyword list, so it
 * will miss some spoilers and hold some harmless messages, which is why "Show now" exists.
 */
export const DELAY_CHOICES = [0, 30, 60, 90] as const
export type DelaySecs = (typeof DELAY_CHOICES)[number]

const WORDS = [
  'goals?', 'scored?', 'scores', 'scoring', 'penalty', 'penalties', 'pen', 'red card', 'sent off', 'sending off',
  'equali[sz]er', 'own goal', 'winner', 'wins', 'won', 'lost', 'loses', 'beat', 'lead', 'leads', 'level', 'wicket',
  'out!', 'six', 'sixer', 'knock(?:ed)? out', 'knockout', 'extra time', 'full time', 'injured', 'injury',
]
const WORD_RE = new RegExp(`\\b(?:${WORDS.join('|')})\\b`, 'i')
const STRETCHED_GOAL = /\bg+o{2,}a+l+s?\b/i
const SCORELINE = /\b\d{1,2}\s*[-:]\s*\d{1,2}\b/

export function isSpoilerLike(body: string): boolean {
  return WORD_RE.test(body) || STRETCHED_GOAL.test(body) || SCORELINE.test(body)
}

/** Milliseconds this message should still be held for a viewer who is `delaySecs` behind. */
export function holdMsLeft(sentAtMs: number, nowMs: number, delaySecs: number): number {
  return Math.max(0, sentAtMs + delaySecs * 1000 - nowMs)
}

export const parseDelay = (raw: string | null): DelaySecs => {
  const n = Number(raw)
  return (DELAY_CHOICES as readonly number[]).includes(n) ? (n as DelaySecs) : 0
}
