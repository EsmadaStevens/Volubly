/** Is the on-device model being woken right now? A tiny shared flag so the screen can say so. */
let warming = false
const listeners = new Set<() => void>()

export const isWarming = () => warming
export function setWarming(on: boolean): void {
  if (warming === on) return
  warming = on
  listeners.forEach((l) => l())
}
export function subscribeWarming(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
