import { useEffect, useRef, useState, type FormEvent } from 'react'
import { newAvatarSeed } from '../lib/avatar'
import { BACKGROUNDS, setBackgroundId, useBackgroundId } from '../lib/background'
import { checkProfileChange, loadLastNameChange, saveLastNameChange } from '../lib/profileEdit'
import { USERNAME_MAX, type PublicProfile } from '../types'
import Avatar from './Avatar'

const field =
  'min-h-[44px] w-full rounded-xl border border-line bg-night px-3 text-base text-ink focus:border-accent focus:outline-none'

const OPTION_COUNT = 8

/** Edit your name and avatar (public) and pick a background (this device only). */
export default function ProfileSheet({
  profile,
  onSave,
  onClose,
  options,
}: {
  profile: PublicProfile
  onSave: (profile: PublicProfile) => Promise<void>
  onClose: () => void
  /** Avatars to pick from. Tests pass fixed ones; the app makes new ones. */
  options?: string[]
}) {
  const [username, setUsername] = useState(profile.username)
  const [seed, setSeed] = useState(profile.avatarSeed)
  const [choices, setChoices] = useState<string[]>(
    () => options ?? [profile.avatarSeed, ...Array.from({ length: OPTION_COUNT - 1 }, newAvatarSeed)],
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const bgId = useBackgroundId()
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function more() {
    // Keep the one you have picked, and offer new ones next to it.
    setChoices([seed, ...Array.from({ length: OPTION_COUNT - 1 }, newAvatarSeed)])
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const check = checkProfileChange(profile, { username, avatarSeed: seed }, loadLastNameChange(), Date.now())
    if (!check.ok) return setError(check.reason)
    if (!check.changed) return onClose()
    setBusy(true)
    try {
      await onSave(check.profile)
      if (check.nameChanged) saveLastNameChange(Date.now())
      onClose()
    } catch (err) {
      console.error('saveProfile failed', err)
      setError("We couldn't save that. Check your connection and try again.")
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        noValidate
        className="max-h-[92vh] w-full max-w-md space-y-5 overflow-y-auto rounded-t-3xl bg-surface p-5 sm:rounded-3xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="profile-title" className="text-xl font-bold text-ink">
            Your profile
          </h2>
          <button type="button" onClick={onClose} className="min-h-[44px] px-3 text-sm font-semibold text-muted">
            Cancel
          </button>
        </div>

        <div className="flex items-center gap-4">
          <Avatar seed={seed} size={72} />
          <label className="block flex-1 space-y-1">
            <span className="text-sm font-semibold text-ink">Username</span>
            <input
              ref={nameRef}
              className={field}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={USERNAME_MAX}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Avatar</legend>
          <div className="grid grid-cols-4 gap-2">
            {choices.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeed(s)}
                aria-pressed={s === seed}
                aria-label={`Avatar option ${i + 1}`}
                className={`flex items-center justify-center rounded-2xl p-1.5 ${s === seed ? 'bg-raised ring-2 ring-accent' : 'bg-night'}`}
              >
                <Avatar seed={s} size={56} />
              </button>
            ))}
          </div>
          <button type="button" onClick={more} className="min-h-[44px] rounded-xl bg-raised px-4 text-sm font-semibold text-ink">
            Show different ones
          </button>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Background</legend>
          <p className="text-xs text-muted">Only you see this. It stays on this device.</p>
          <div className="grid grid-cols-4 gap-2">
            {BACKGROUNDS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBackgroundId(b.id)}
                aria-pressed={b.id === bgId}
                className="space-y-1 text-center"
              >
                <span
                  className={`block h-12 rounded-xl border ${b.id === bgId ? 'border-accent ring-2 ring-accent' : 'border-line'}`}
                  style={{ background: b.css }}
                />
                <span className="block text-xs text-muted">{b.label}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <p className="text-xs text-muted">
          Your username and avatar are what other people see in rooms. They see a change the next time they open the room.
        </p>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] w-full rounded-xl bg-accent px-5 text-base font-bold text-night disabled:opacity-50"
        >
          {busy ? 'Saving' : 'Save'}
        </button>
      </form>
    </div>
  )
}
