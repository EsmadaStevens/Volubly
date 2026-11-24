import { checkUsername } from './username'
import type { PublicProfile } from '../types'

/** How long someone waits between name changes. It limits casual name-flipping on this device, it is not a guarantee. */
export const NAME_CHANGE_COOLDOWN_MS = 5 * 60 * 1000

/** Milliseconds still to wait before the name may change again, or 0 if it may change now. */
export function nameChangeWaitMs(lastChangedAtMs: number | null, nowMs: number, cooldownMs = NAME_CHANGE_COOLDOWN_MS): number {
  if (lastChangedAtMs === null) return 0
  return Math.max(0, lastChangedAtMs + cooldownMs - nowMs)
}

export function waitText(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000))
  return `You can change your name again in ${mins} ${mins === 1 ? 'minute' : 'minutes'}.`
}

export type ProfileCheck =
  | { ok: true; profile: PublicProfile; nameChanged: boolean; changed: boolean }
  | { ok: false; reason: string }

/**
 * Decides whether a requested profile is allowed. The avatar can always change. The name has to
 * pass the same check as at sign-up, and can only change after the cooldown.
 */
export function checkProfileChange(
  current: PublicProfile,
  want: { username: string; avatarSeed: string },
  lastNameChangeAtMs: number | null,
  nowMs: number,
): ProfileCheck {
  const name = checkUsername(want.username)
  if (!name.ok) return { ok: false, reason: name.reason }
  const nameChanged = name.value !== current.username
  const avatarChanged = want.avatarSeed !== current.avatarSeed
  if (nameChanged) {
    const wait = nameChangeWaitMs(lastNameChangeAtMs, nowMs)
    if (wait > 0) return { ok: false, reason: waitText(wait) }
  }
  return {
    ok: true,
    profile: { username: name.value, avatarSeed: want.avatarSeed },
    nameChanged,
    changed: nameChanged || avatarChanged,
  }
}

const NAME_KEY = 'volubly.nameChangedAt'

export function loadLastNameChange(): number | null {
  try {
    const v = Number(localStorage.getItem(NAME_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

export function saveLastNameChange(ms: number): void {
  try {
    localStorage.setItem(NAME_KEY, String(ms))
  } catch {
    /* private window: the cooldown just will not be remembered */
  }
}
