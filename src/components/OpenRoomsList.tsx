import { formatTimeLeft, msLeft } from '../lib/roomUtils'
import type { RoomView } from '../types'
import LiveDot from './LiveDot'

/** The list itself: no data fetching, so it can be drawn and tested on its own. */
export default function OpenRoomsList({ rooms, nowMs }: { rooms: RoomView[]; nowMs: number }) {
  if (rooms.length === 0) return <p className="text-xs text-muted">No other rooms are open right now.</p>
  return (
    <ul className="space-y-2">
      {rooms.map((r) => (
        <li key={r.id}>
          <a
            href={`#room/${r.id}`}
            className="block min-h-[44px] rounded-xl bg-surface px-3 py-2 hover:bg-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-spark"
          >
            <span className="block break-words text-sm font-bold text-ink">{r.title}</span>
            <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
              <span className="flex items-center gap-1 font-semibold text-live">
                <LiveDot />
                {r.postingParticipantCount === 0 ? 'Be the first' : `${r.postingParticipantCount} posted`}
              </span>
              <span>{formatTimeLeft(msLeft(r.openedAtMs, nowMs))}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}
