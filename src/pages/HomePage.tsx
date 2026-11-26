import { useMemo, useState } from 'react'
import Avatar from '../components/Avatar'
import CategoryChips from '../components/CategoryChips'
import CreateRoomSheet from '../components/CreateRoomSheet'
import LiveDot from '../components/LiveDot'
import ProfileSheet from '../components/ProfileSheet'
import RoomCard from '../components/RoomCard'
import TryItCard from '../components/TryItCard'
import SortTabs from '../components/SortTabs'
import type { ReadySession } from '../components/AuthGate'
import { primeProfile } from '../hooks/useProfiles'
import { useNow } from '../hooks/useNow'
import { useRooms } from '../hooks/useRooms'
import { splitAndSort } from '../lib/discoveryUtils'
import { loadPicks, savePicks } from '../lib/picks'
import { saveProfile } from '../lib/profileApi'
import type { Category, SortOrder } from '../types'

export default function HomePage({ session }: { session: ReadySession }) {
  const [order, setOrder] = useState<SortOrder>('newest')
  const [picks, setPicks] = useState<Category[]>(loadPicks)
  const [editingPicks, setEditingPicks] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const { state, retry } = useRooms(session.ageBand, order)
  const now = useNow()

  const split = useMemo(
    () => (state.status === 'ready' ? splitAndSort(state.rooms, picks, order, now) : null),
    [state, picks, order, now],
  )

  function togglePick(c: Category) {
    const next = picks.includes(c) ? picks.filter((x) => x !== c) : [...picks, c]
    setPicks(next)
    savePicks(next)
  }

  const open = (id: string) => {
    window.location.hash = `#room/${id}`
  }

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pb-10 md:max-w-3xl lg:max-w-none lg:px-8">
      <header className="flex items-center justify-between py-4">
        <div className="flex items-center gap-2">
          <LiveDot />
          <span className="text-xl font-bold tracking-tight text-ink">Volubly</span>
        </div>
        <button
          type="button"
          onClick={() => setEditingProfile(true)}
          aria-label="Edit your profile"
          className="flex min-h-[44px] items-center gap-2 rounded-full pl-2"
        >
          <span className="max-w-[9rem] truncate text-sm font-semibold text-muted">{session.profile.username}</span>
          <Avatar seed={session.profile.avatarSeed} size={36} />
        </button>
      </header>

      <section className="space-y-4">
        <TryItCard />
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-ink">Live rooms</h1>
            <p className="text-xs text-muted">Each room closes 24 hours after it opens.</p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="min-h-[44px] shrink-0 rounded-full bg-accent px-4 text-sm font-bold text-night"
          >
            New room
          </button>
        </div>

        <SortTabs value={order} onChange={setOrder} />

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setEditingPicks((v) => !v)}
            aria-expanded={editingPicks}
            className="min-h-[44px] text-sm font-semibold text-spark"
          >
            {picks.length === 0 ? 'Choose your categories' : `Your categories (${picks.length})`}
          </button>
          {editingPicks && <CategoryChips label="Your categories" selected={picks} onToggle={togglePick} />}
        </div>

        {state.status === 'loading' && <p className="text-sm text-muted">Loading rooms...</p>}

        {state.status === 'error' && (
          <div className="space-y-3 rounded-2xl bg-surface p-4">
            <p role="alert" className="text-sm text-ink">
              {state.message}
            </p>
            <button type="button" onClick={retry} className="min-h-[44px] rounded-xl bg-accent px-4 text-sm font-bold text-night">
              Try again
            </button>
          </div>
        )}

        {split && split.picks.length === 0 && split.other.length === 0 && (
          <div className="rounded-2xl bg-surface p-5 text-center">
            <p className="text-base font-semibold text-ink">No rooms are live right now.</p>
            <p className="mt-1 text-sm text-muted">Start one and see who joins.</p>
          </div>
        )}

        {split && split.picks.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-accent">Your picks</h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {split.picks.map((r) => (
                <RoomCard key={r.id} room={r} picks={picks} onOpen={open} />
              ))}
            </div>
          </div>
        )}

        {split && split.other.length > 0 && (
          <div className="space-y-3">
            {picks.length > 0 && <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Also live</h2>}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {split.other.map((r) => (
                <RoomCard key={r.id} room={r} picks={picks} onOpen={open} />
              ))}
            </div>
          </div>
        )}
      </section>

      <footer className="mt-8 rounded-2xl bg-raised p-3 text-xs text-muted">
        Rooms close after 24 hours. In rooms, only your username and avatar show.
      </footer>

      {creating && (
        <CreateRoomSheet
          uid={session.uid}
          ageBand={session.ageBand}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            open(id)
          }}
        />
      )}

      {editingProfile && (
        <ProfileSheet
          profile={session.profile}
          onClose={() => setEditingProfile(false)}
          onSave={async (p) => {
            await saveProfile(session.uid, p)
            // Show it here straight away; other people see it the next time they load your profile.
            primeProfile(session.uid, p)
            session.setProfile(p)
          }}
        />
      )}
    </div>
  )
}
