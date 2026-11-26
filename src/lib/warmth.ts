/**
 * The on-device model is loaded into memory on first use and Chrome can unload it again after
 * the page has been idle. A cold call can take ten seconds or more; a warm one about a second.
 * So "cold" is not just "first call this page": it is also "nothing has run for a while".
 */
export const COLD_AFTER_MS = 90_000
export const COLD_TIMEOUT_MS = 15_000
export const WARM_TIMEOUT_MS = 6_000

/** lastRunAt is when an on-device call last finished OK on this page, or null if none has. */
export function isCold(lastRunAt: number | null, now: number): boolean {
  return lastRunAt === null || now - lastRunAt > COLD_AFTER_MS
}

export function onDeviceTimeout(lastRunAt: number | null, now: number): number {
  return isCold(lastRunAt, now) ? COLD_TIMEOUT_MS : WARM_TIMEOUT_MS
}
