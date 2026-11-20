/**
 * Finds things people usually do not mean to share in a public room and hides them.
 * This is plain code, not AI: it is instant, works on every device, and never sends
 * anything anywhere. It catches common patterns only. It is not a guarantee.
 */
export type FindingKind = 'phone' | 'email' | 'key' | 'password' | 'card'

export interface Finding {
  kind: FindingKind
  start: number
  end: number
}

export interface Redaction {
  findings: Finding[]
  redacted: string
}

export const PLACEHOLDER: Record<FindingKind, string> = {
  phone: '[number hidden]',
  card: '[number hidden]',
  email: '[email hidden]',
  key: '[key hidden]',
  password: '[password hidden]',
}

export const FINDING_LABEL: Record<FindingKind, string> = {
  phone: 'a phone number',
  card: 'a card number',
  email: 'an email address',
  key: 'a key or token',
  password: 'a password or PIN',
}

function luhn(digits: string): boolean {
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

const digitsOf = (s: string) => s.replace(/\D/g, '')
const DATE_LIKE = [/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/, /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/]

interface Rule {
  kind: FindingKind
  re: RegExp
  /** Which part of the match to hide (default: all of it). */
  pick?: (m: RegExpExecArray) => { start: number; end: number }
  accept?: (m: RegExpExecArray) => boolean
}

const RULES: Rule[] = [
  { kind: 'email', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  {
    kind: 'key',
    re: /\b(?:(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  },
  {
    kind: 'key',
    re: /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g,
  },
  {
    kind: 'password',
    re: /\b(password|passcode|passwd|pwd|pin)\b(\s*(?:is|:|=)\s*)(\S+)/gi,
    pick: (m) => {
      const start = m.index + m[1].length + m[2].length
      return { start, end: start + m[3].length }
    },
  },
  {
    kind: 'card',
    re: /(?<![\w])(?:\d[ -]?){12,18}\d(?![\w])/g,
    accept: (m) => {
      const d = digitsOf(m[0])
      return d.length >= 13 && d.length <= 19 && luhn(d)
    },
  },
  {
    kind: 'phone',
    re: /(?<![\w])[+(]?\d[\d ().-]{5,}\d(?![\w])/g,
    accept: (m) => {
      const d = digitsOf(m[0]).length
      return d >= 7 && d <= 15 && !DATE_LIKE.some((r) => r.test(m[0].trim()))
    },
  },
]

export function redact(text: string): Redaction {
  const claimed: Finding[] = []
  const overlaps = (s: number, e: number) => claimed.some((f) => s < f.end && e > f.start)

  for (const rule of RULES) {
    rule.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.re.exec(text)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex++
        continue
      }
      if (rule.accept && !rule.accept(m)) continue
      const { start, end } = rule.pick ? rule.pick(m) : { start: m.index, end: m.index + m[0].length }
      if (!overlaps(start, end)) claimed.push({ kind: rule.kind, start, end })
    }
  }

  const findings = claimed.sort((a, b) => a.start - b.start)
  let out = text
  for (const f of [...findings].reverse()) {
    out = out.slice(0, f.start) + PLACEHOLDER[f.kind] + out.slice(f.end)
  }
  return { findings, redacted: out }
}
