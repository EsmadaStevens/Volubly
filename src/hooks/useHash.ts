import { useSyncExternalStore } from 'react'

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

/** The current "#..." part of the address. Updates when it changes, no refresh needed. */
export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash, () => '')
}
