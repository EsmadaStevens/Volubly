import { CATEGORY_ALLOWLIST, type Category } from '../types'

const KEY = 'volubly.picks'

/** Turns stored text back into a clean list of categories. Anything unexpected is dropped. */
export function parsePicks(raw: string | null): Category[] {
  if (!raw) return []
  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    const valid = data.filter((c): c is Category => (CATEGORY_ALLOWLIST as readonly unknown[]).includes(c))
    return Array.from(new Set(valid))
  } catch {
    return []
  }
}

// Picks live only in this browser. localStorage can be unavailable, so every access is guarded.
export function loadPicks(): Category[] {
  try {
    return parsePicks(localStorage.getItem(KEY))
  } catch {
    return []
  }
}

export function savePicks(picks: Category[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(picks))
  } catch {
    /* picks just will not persist */
  }
}
