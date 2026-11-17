import { useNow } from '../hooks/useNow'
import { matchedPick } from '../lib/discoveryUtils'
import { formatTimeLeft, HOUR_MS, msLeft, reasonLabel } from '../lib/roomUtils'
import { CATEGORY_LABELS, MATURITY_DISPLAY, ROOM_TYPE_DISPLAY, type Category, type RoomView } from '../types'
import LiveDot from './LiveDot'

const chip = 'rounded-full bg-raised px-2.5 py-1 text-xs font-semibold text-muted'

export default function RoomCard({
  room,
  picks,
  onOpen,
}: {
  room: RoomView
  picks: Category[]
  onOpen: (id: string) => void
}) {
  const now = useNow()
  const left = msLeft(room.openedAtMs, now)
  const ending = left < HOUR_MS
  const reason = reasonLabel({ matchedPick: matchedPick(room, picks), ageMs: now - room.openedAtMs, leftMs: left })

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line/40 bg-surface p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-lg font-bold leading-6 text-ink">{room.title}</h3>
          <p className="mt-0.5 text-xs text-muted">{reason}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-night px-2.5 py-1">
          <LiveDot />
          <span className="text-xs font-semibold text-live">
            {room.postingParticipantCount === 0 ? 'Be the first' : `${room.postingParticipantCount} posting`}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            ending ? 'bg-danger/15 text-danger' : 'bg-plum/20 text-plum'
          }`}
        >
          {formatTimeLeft(left)}
        </span>
        <span className={chip}>{ROOM_TYPE_DISPLAY[room.type]}</span>
        <span className={chip}>{MATURITY_DISPLAY[room.maturityLabel]}</span>
        {room.categories.slice(0, 2).map((c) => (
          <span key={c} className={chip}>
            {CATEGORY_LABELS[c]}
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onOpen(room.id)}
        className="min-h-[44px] w-full rounded-xl bg-accent text-base font-bold text-night active:scale-[0.99]"
      >
        Join room
      </button>
    </article>
  )
}
