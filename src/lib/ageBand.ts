import type { AgeBandLabel } from '../types'

/**
 * Turns a date of birth ("YYYY-MM-DD") into an age band.
 * The date of birth is used for this calculation only. It is never stored or sent anywhere.
 * Returns null for anything that is not a real, past date within 120 years.
 */
export function ageBandFromBirthDate(dob: string, now: Date = new Date()): AgeBandLabel | null {
  const age = ageOn(dob, now)
  if (age === null) return null
  if (age < 13) return 'under_13'
  if (age < 18) return '13_17'
  return '18_plus'
}

/** Whole years old on `now`, or null for anything that is not a real, past date within 120 years. */
function ageOn(dob: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])

  // Reject dates that do not exist (31 Feb, month 13, ...).
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null
  }

  let age = now.getFullYear() - y
  const beforeBirthday = now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)
  if (beforeBirthday) age -= 1

  if (age < 0 || age > 120) return null
  return age
}

/**
 * A real date, but so recent (under 4 years ago, which includes today) that it is almost
 * certainly a slip, like leaving the picker on today's date. These get a "please check" message
 * and are not treated as a child signing up.
 */
export function looksLikeSlip(dob: string, now: Date = new Date()): boolean {
  const age = ageOn(dob, now)
  return age !== null && age < 4
}
