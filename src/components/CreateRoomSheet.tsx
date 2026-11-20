import { useEffect, useRef, useState, type FormEvent } from 'react'
import { allowedMaturities } from '../lib/discoveryUtils'
import { createRoom } from '../lib/rooms'
import { RoomLimitError } from '../lib/roomSlots'
import { checkRoomTitle, ROOM_TITLE_MAX } from '../lib/roomTitle'
import {
  MATURITY_DISPLAY,
  ROOM_TYPES,
  ROOM_TYPE_DISPLAY,
  type AgeBandLabel,
  type Category,
  type MaturityLabel,
  type RoomType,
} from '../types'
import CategoryChips from './CategoryChips'

const field =
  'min-h-[44px] w-full rounded-xl border border-line bg-night px-3 text-base text-ink focus:border-accent focus:outline-none'

export default function CreateRoomSheet({
  uid,
  ageBand,
  onClose,
  onCreated,
}: {
  uid: string
  ageBand: AgeBandLabel
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const maturities = allowedMaturities(ageBand)
  const [type, setType] = useState<RoomType>('live_room')
  const [title, setTitle] = useState('')
  const [maturity, setMaturity] = useState<MaturityLabel>('all_ages')
  const [cats, setCats] = useState<Category[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function toggle(c: Category) {
    setCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const t = checkRoomTitle(title)
    if (!t.ok) return setError(t.reason)
    if (cats.length === 0) return setError('Pick at least one category.')
    setBusy(true)
    try {
      const id = await createRoom({ uid, type, title: t.value, maturityLabel: maturity, categories: cats })
      onCreated(id)
    } catch (err) {
      if (err instanceof RoomLimitError) {
        setError('You already have 2 live rooms. You can start another when one of them closes.')
      } else {
        console.error('createRoom failed', err)
        setError("We couldn't start the room. Check your connection and try again.")
      }
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-room-title"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        noValidate
        className="max-h-[92vh] w-full max-w-md space-y-5 overflow-y-auto rounded-t-3xl bg-surface p-5 sm:rounded-3xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="new-room-title" className="text-xl font-bold text-ink">
            Start a room
          </h2>
          <button type="button" onClick={onClose} className="min-h-[44px] px-3 text-sm font-semibold text-muted">
            Cancel
          </button>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-semibold text-ink">What is happening?</span>
          <input
            ref={titleRef}
            className={field}
            value={title}
            maxLength={ROOM_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            autoComplete="off"
          />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Kind of room</legend>
          <div className="flex gap-2">
            {ROOM_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => setType(t)}
                className={`min-h-[44px] flex-1 rounded-xl text-sm font-semibold ${
                  type === t ? 'bg-accent text-night' : 'bg-raised text-muted'
                }`}
              >
                {ROOM_TYPE_DISPLAY[t]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Who is it for?</legend>
          <div className="flex gap-2">
            {maturities.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={maturity === m}
                onClick={() => setMaturity(m)}
                className={`min-h-[44px] flex-1 rounded-xl text-sm font-semibold ${
                  maturity === m ? 'bg-accent text-night' : 'bg-raised text-muted'
                }`}
              >
                {MATURITY_DISPLAY[m]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-ink">Categories (up to 3)</p>
          <CategoryChips label="Categories" selected={cats} onToggle={toggle} max={3} />
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] w-full rounded-xl bg-accent text-base font-bold text-night disabled:opacity-60"
        >
          {busy ? 'Starting...' : 'Start room'}
        </button>
        <p className="text-xs text-muted">The room closes 24 hours after it opens.</p>
      </form>
    </div>
  )
}
