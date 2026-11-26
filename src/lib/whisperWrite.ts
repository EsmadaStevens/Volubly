/**
 * Guards around a write. The Firestore web SDK does not reject a write while the device is offline:
 * it queues it, and the commit promise just waits. So every write first checks that the device is
 * online and then races the commit against a timer. No button should ever spin forever.
 *
 * Pure: no Firebase import, so it runs under Node (the emulator test) and under fake timers.
 */

export const WRITE_TIMEOUT_MS = 10_000

export class WriteTimeoutError extends Error {
  readonly code = 'timeout'
  constructor() {
    super('The write did not finish in time.')
    this.name = 'WriteTimeoutError'
  }
}

/**
 * True unless the browser says it is offline. Outside a browser (Node, where the emulator test runs)
 * `navigator` is missing, or has no `onLine`. That counts as online, or every write would be refused.
 */
export function isOnline(nav: { onLine?: boolean } | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  return !nav || nav.onLine !== false
}

/**
 * Settles with the promise, or rejects with WriteTimeoutError after `ms`.
 * The timer is always cleared when the promise settles first, and never keeps Node alive.
 * If the promise settles after the timeout, its result is ignored (and a rejection is handled).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new WriteTimeoutError()), ms)
    ;(timer as unknown as { unref?: () => void }).unref?.()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export type WriteResult =
  | { ok: true }
  /** `reason` is for the console only (an error code). It is never shown to the person. */
  | { ok: false; code: 'generic'; reason: string }

export function reasonOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === 'string') return code
  return err instanceof Error ? err.name : 'unknown'
}

/**
 * Runs a write with the offline check and the timeout. Offline: nothing is written.
 * Any rejection or timeout becomes the generic result, so the screen cannot reveal a cause.
 */
export async function runGuarded(
  apply: () => Promise<unknown>,
  opts: { online?: boolean; timeoutMs?: number } = {},
): Promise<WriteResult> {
  const online = opts.online ?? isOnline()
  if (!online) return { ok: false, code: 'generic', reason: 'offline' }
  try {
    await withTimeout(apply(), opts.timeoutMs ?? WRITE_TIMEOUT_MS)
    return { ok: true }
  } catch (err) {
    return { ok: false, code: 'generic', reason: reasonOf(err) }
  }
}
