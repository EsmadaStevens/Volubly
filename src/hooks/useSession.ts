import { useCallback, useEffect, useState } from 'react'
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import type { AgeBandLabel, PublicProfile } from '../types'

export type SessionState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'needs-onboarding'; uid: string }
  | { status: 'ready'; uid: string; profile: PublicProfile; ageBand: AgeBandLabel }

export function useSession() {
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const set = (s: SessionState) => {
      if (!cancelled) setState(s)
    }
    const fail = (e: unknown) => {
      console.error('Session error', e)
      set({ status: 'error', message: "We couldn't reach Volubly. Check your connection and try again." })
    }

    set({ status: 'loading' })
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        try {
          await signInAnonymously(auth)
        } catch (e) {
          fail(e)
        }
        return // onAuthStateChanged fires again once signed in
      }
      try {
        const [userSnap, profileSnap] = await Promise.all([
          getDoc(doc(db, 'users', user.uid)),
          getDoc(doc(db, 'publicProfiles', user.uid)),
        ])
        if (!userSnap.exists() || !profileSnap.exists()) {
          set({ status: 'needs-onboarding', uid: user.uid })
          return
        }
        set({
          status: 'ready',
          uid: user.uid,
          profile: profileSnap.data() as PublicProfile,
          ageBand: userSnap.data().ageBandLabel as AgeBandLabel,
        })
      } catch (e) {
        fail(e)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const completeOnboarding = useCallback((uid: string, profile: PublicProfile, ageBand: AgeBandLabel) => {
    setState({ status: 'ready', uid, profile, ageBand })
  }, [])

  return { state, retry, completeOnboarding }
}
