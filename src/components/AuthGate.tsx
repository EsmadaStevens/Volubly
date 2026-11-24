import type { ReactNode } from 'react'
import { useSession } from '../hooks/useSession'
import LoadingScreen from './LoadingScreen'
import OnboardingPage from '../pages/OnboardingPage'
import type { AgeBandLabel, PublicProfile } from '../types'

export interface ReadySession {
  uid: string
  profile: PublicProfile
  ageBand: AgeBandLabel
  createdAtMs: number
  /** Lets the app show a new name or avatar straight away after the person edits their profile. */
  setProfile: (profile: PublicProfile) => void
}

export default function AuthGate({ children }: { children: (session: ReadySession) => ReactNode }) {
  const { state, retry, completeOnboarding, setProfile } = useSession()

  if (state.status === 'loading') {
    return <LoadingScreen />
  }

  if (state.status === 'error') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
        <p role="alert" className="text-sm text-ink">
          {state.message}
        </p>
        <button
          onClick={retry}
          className="min-h-[44px] rounded-lg bg-accent px-4 text-base font-bold text-night"
        >
          Try again
        </button>
      </main>
    )
  }

  if (state.status === 'needs-onboarding') {
    return <OnboardingPage uid={state.uid} onDone={completeOnboarding} />
  }

  return <>{children({ uid: state.uid, profile: state.profile, ageBand: state.ageBand, createdAtMs: state.createdAtMs, setProfile })}</>
}
