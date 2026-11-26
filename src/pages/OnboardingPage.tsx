import { useState, type FormEvent } from 'react'
import Avatar from '../components/Avatar'
import { createAccount } from '../lib/account'
import { ageBandFromBirthDate, looksLikeSlip } from '../lib/ageBand'
import { newAvatarSeed } from '../lib/avatar'
import { checkUsername } from '../lib/username'
import { USERNAME_MAX, type AgeBandLabel, type PublicProfile } from '../types'

// Under-13 sign-ups are not accepted in this version (the rules still support the band).
// Flip this only after getting proper advice on children's privacy law.
const ALLOW_UNDER_13 = false
const BLOCK_KEY = 'volubly.signup-blocked'

function isBlocked(): boolean {
  try {
    return localStorage.getItem(BLOCK_KEY) === '1'
  } catch {
    return false
  }
}
function markBlocked() {
  try {
    localStorage.setItem(BLOCK_KEY, '1')
  } catch {
    /* best effort only */
  }
}

function todayIso(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export default function OnboardingPage({
  uid,
  onDone,
}: {
  uid: string
  onDone: (uid: string, profile: PublicProfile, ageBand: AgeBandLabel) => void
}) {
  const [username, setUsername] = useState('')
  const [dob, setDob] = useState('')
  const [avatarSeed, setAvatarSeed] = useState(newAvatarSeed)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(isBlocked)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const name = checkUsername(username)
    if (!name.ok) return setError(name.reason)

    // Today's date, or any date in the last few years, is a slip (the picker defaults near it).
    // It must not count as a child signing up, because that would lock this browser out.
    if (looksLikeSlip(dob)) return setError("That date is too recent to be a date of birth. Please enter your own.")
    const band = ageBandFromBirthDate(dob)
    if (!band) return setError('Please enter a valid date of birth.')
    if (band === 'under_13' && !ALLOW_UNDER_13) {
      markBlocked()
      return setBlocked(true)
    }

    setBusy(true)
    try {
      await createAccount({ uid, username: name.value, avatarSeed, ageBand: band })
      onDone(uid, { username: name.value, avatarSeed }, band)
    } catch (err) {
      console.error('createAccount failed', err)
      setError("We couldn't create your account. Check your connection and try again.")
      setBusy(false)
    }
  }

  if (blocked) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-4">
        <h1 className="text-2xl font-semibold">We can't create an account for you right now</h1>
        <p className="text-sm text-muted">Volubly is for people aged 13 and over. Thanks for stopping by.</p>
      </main>
    )
  }

  const input =
    'min-h-[44px] w-full rounded-lg border border-line bg-surface px-3 text-base text-ink ' +
    'focus:border-accent focus:outline-none'

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Welcome to Volubly</h1>
        <p className="text-sm text-muted">
          Pick a name and an avatar. In rooms, only these two are shown.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-5" noValidate>
        <div className="flex items-center gap-4">
          <Avatar seed={avatarSeed} size={72} />
          <button
            type="button"
            onClick={() => setAvatarSeed(newAvatarSeed())}
            className="min-h-[44px] rounded-lg border border-line px-4 text-sm text-ink hover:border-accent"
          >
            Shuffle avatar
          </button>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Username</span>
          <input
            className={input}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={USERNAME_MAX}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={error !== null}
            aria-describedby="onboarding-help"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Date of birth</span>
          <input
            type="date"
            className={input}
            value={dob}
            max={todayIso()}
            min="1900-01-01"
            onChange={(e) => setDob(e.target.value)}
          />
        </label>

        <p id="onboarding-help" className="text-xs text-muted">
          Volubly is for ages 13 and over. We use your date of birth once to set up your account. We keep an age group, not the date.
        </p>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] w-full rounded-lg bg-accent px-4 text-base font-bold text-night disabled:opacity-60"
        >
          {busy ? 'Creating your account...' : 'Continue'}
        </button>
      </form>

      <p className="text-xs text-muted">
        Your account lives in this browser. If you clear your browser data, you will start fresh.
      </p>
    </main>
  )
}
