import { USERNAME_MAX, USERNAME_MIN } from '../types'

// Names that could be mistaken for staff, moderators or unlabelled automation.
const RESERVED = new Set([
  'admin', 'administrator', 'moderator', 'mod', 'staff', 'support', 'official',
  'system', 'volubly', 'bot', 'kiro', 'firebase', 'google', 'help', 'security',
])

export type UsernameCheck = { ok: true; value: string } | { ok: false; reason: string }

export function checkUsername(raw: string): UsernameCheck {
  const value = raw.trim()
  if (value.length < USERNAME_MIN) {
    return { ok: false, reason: `Use at least ${USERNAME_MIN} characters.` }
  }
  if (value.length > USERNAME_MAX) {
    return { ok: false, reason: `Use at most ${USERNAME_MAX} characters.` }
  }
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    return { ok: false, reason: 'Use only letters, numbers and underscores.' }
  }
  // "Admin_42" and "mod" are treated like "admin" and "mod".
  const normalised = value.toLowerCase().replace(/_/g, '').replace(/\d+$/, '')
  if (RESERVED.has(normalised)) {
    return { ok: false, reason: 'That name is reserved. Please pick another.' }
  }
  return { ok: true, value }
}
