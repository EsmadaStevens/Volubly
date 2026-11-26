import { useNow } from '../hooks/useNow'
import { useRooms } from '../hooks/useRooms'
import { otherOpenRooms } from '../lib/openRooms'
import type { AgeBandLabel } from '../types'
import OpenRoomsList from './OpenRoomsList'

/** Wide screens only (the caller decides): other open rooms, one tap to switch. */
export default function OpenRooms({ ageBand, currentId }: { ageBand: AgeBandLabel; currentId: string }) {
  const { state, retry } = useRooms(ageBand, 'newest')
  const now = useNow()
  return (
    <section aria-label="Open rooms" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-accent">Open rooms</h2>
        <a href="#" className="min-h-[44px] py-3 text-xs font-semibold text-spark">
          All rooms
        </a>
      </div>
      {state.status === 'loading' && <p className="text-xs text-muted">Loading rooms...</p>}
      {state.status === 'error' && (
        <p className="text-xs text-muted">
          {state.message}{' '}
          <button type="button" onClick={retry} className="font-bold text-spark underline">
            Try again
          </button>
        </p>
      )}
      {state.status === 'ready' && <OpenRoomsList rooms={otherOpenRooms(state.rooms, currentId, now)} nowMs={now} />}
    </section>
  )
}
