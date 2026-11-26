import { useEffect, useRef, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { PublicProfile } from '../types'

// One cached lookup per person, shared by every message on screen.
// undefined = still loading, null = no profile found.
const cache = new Map<string, PublicProfile | null>()
const inflight = new Set<string>()

/** Put a known profile into the cache so it shows without a Firestore read. */
export function primeProfile(uid: string, profile: PublicProfile): void {
  cache.set(uid, profile)
}

export function useProfiles(uids: string[]): Map<string, PublicProfile | null> {
  const [, bump] = useState(0)
  const mounted = useRef(true)
  const key = Array.from(new Set(uids)).sort().join(',')

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    for (const uid of key ? key.split(',') : []) {
      if (cache.has(uid) || inflight.has(uid)) continue
      inflight.add(uid)
      getDoc(doc(db, 'publicProfiles', uid))
        .then((s) => cache.set(uid, s.exists() ? (s.data() as PublicProfile) : null))
        .catch(() => cache.set(uid, null))
        .finally(() => {
          inflight.delete(uid)
          if (mounted.current) bump((n) => n + 1)
        })
    }
  }, [key])

  return cache
}
