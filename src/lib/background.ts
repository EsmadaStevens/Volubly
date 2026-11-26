import { useSyncExternalStore } from 'react'

/**
 * Backgrounds are a personal choice kept on this device only. Nobody else sees yours and nothing
 * is stored on the server. Every one is dark enough that the app's text stays easy to read.
 */
export interface Background {
  id: string
  label: string
  /** CSS background value. */
  css: string
  /** The colours this background is made of, used to check text contrast. */
  stops: string[]
}

const DOTS = 'radial-gradient(rgba(255,110,199,0.14) 1.2px, transparent 1.2px) 0 0 / 20px 20px, #0f0d15'

export const BACKGROUNDS: Background[] = [
  { id: 'night', label: 'Night', css: '#0f0d15', stops: ['#0f0d15'] },
  { id: 'midnight', label: 'Midnight', css: 'linear-gradient(160deg, #0b1020, #14233f)', stops: ['#0b1020', '#14233f'] },
  { id: 'plum', label: 'Plum', css: 'linear-gradient(160deg, #150d1f, #2a1245)', stops: ['#150d1f', '#2a1245'] },
  { id: 'forest', label: 'Forest', css: 'linear-gradient(160deg, #0a1511, #12352a)', stops: ['#0a1511', '#12352a'] },
  { id: 'ocean', label: 'Ocean', css: 'linear-gradient(160deg, #08161c, #0e3a4a)', stops: ['#08161c', '#0e3a4a'] },
  { id: 'ember', label: 'Ember', css: 'linear-gradient(160deg, #1a0d0d, #3b1a1f)', stops: ['#1a0d0d', '#3b1a1f'] },
  { id: 'dusk', label: 'Dusk', css: 'linear-gradient(160deg, #1c0f1e, #4a1d3a)', stops: ['#1c0f1e', '#4a1d3a'] },
  { id: 'dots', label: 'Dots', css: DOTS, stops: ['#0f0d15'] },
]

export const DEFAULT_BACKGROUND = BACKGROUNDS[0]

export function resolveBackground(id: string | null | undefined): Background {
  return BACKGROUNDS.find((b) => b.id === id) ?? DEFAULT_BACKGROUND
}

// WCAG relative luminance and contrast ratio.
function channel(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ---- A tiny store so picking a background changes the whole app at once. ----
const KEY = 'volubly.background'
const subs = new Set<() => void>()

function read(): string {
  try {
    return resolveBackground(localStorage.getItem(KEY)).id
  } catch {
    return DEFAULT_BACKGROUND.id
  }
}
let current = read()

export function setBackgroundId(id: string): void {
  current = resolveBackground(id).id
  try {
    localStorage.setItem(KEY, current)
  } catch {
    /* private window: it just will not be remembered */
  }
  subs.forEach((f) => f())
}

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}

export function useBackgroundId(): string {
  return useSyncExternalStore(subscribe, () => current, () => current)
}
export function useBackground(): Background {
  return resolveBackground(useBackgroundId())
}
