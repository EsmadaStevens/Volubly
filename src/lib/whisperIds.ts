/**
 * A new whisper id: letters and digits only, so it fits the `#whisper/{id}` route. The rules do not
 * constrain the id, so a random one made on this device is enough. Made once per invite sheet and
 * reused on retry, so a retry cannot create a second whisper.
 */
export function newWhisperId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '')
  const bytes = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
