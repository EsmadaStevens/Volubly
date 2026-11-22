import type { ReadySession } from '../components/AuthGate'
import CatchUpBar from '../components/CatchUpBar'
import LiveDot from '../components/LiveDot'
import MessageComposer from '../components/MessageComposer'
import MessageList from '../components/MessageList'
import { useMessageGuard } from '../hooks/useMessageGuard'
import { useMessages } from '../hooks/useMessages'
import { useNow } from '../hooks/useNow'
import { useRoom } from '../hooks/useRoom'
import { useUnseen } from '../hooks/useUnseen'
import DemoTools from '../components/DemoTools'
import { simulatedChatter, simulatedFlagged, simulatedSpoilers } from '../lib/demoData'
import DelayControl from '../components/DelayControl'
import { useDelaySetting, useDelayShield } from '../hooks/useDelayShield'
import { useGhostCheck } from '../hooks/useGhostCheck'
import GhostStatus from '../components/GhostStatus'
import type { MessagesState } from '../hooks/useMessages'
import { formatTimeLeft, isExpired, msLeft } from '../lib/roomUtils'
import { scrollToLatest } from '../lib/scrollUtils'
import { MATURITY_DISPLAY, type MessageView, type RoomView } from '../types'
import { useMemo, useState } from 'react'
import type { Timestamp } from 'firebase/firestore'

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-md space-y-3 p-4">
      <a href="#" className="inline-block min-h-[44px] py-3 text-sm font-semibold text-spark">
        Back to rooms
      </a>
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      <p className="text-sm text-muted">{body}</p>
    </main>
  )
}

/** Everything that needs the room to be open and loaded. */
function RoomBody({
  roomId,
  room,
  expiresAt,
  session,
  demo,
}: {
  roomId: string
  room: RoomView
  expiresAt: Timestamp
  session: ReadySession
  demo: boolean
}) {
  const now = useNow()
  const realState = useMessages(roomId)
  // Demo mode only: simulated messages live in this component's memory, never in the database.
  const [sim, setSim] = useState<MessageView[]>([])
  const msgState: MessagesState = useMemo(() => {
    if (!demo || realState.status !== 'ready') return realState
    return { status: 'ready', messages: [...realState.messages, ...sim].sort((a, b) => a.sentAtMs - b.sentAtMs) }
  }, [demo, realState, sim])
  const messages = msgState.status === 'ready' ? msgState.messages : []
  const hidden = useMessageGuard(messages, session.uid)
  const unseen = useUnseen(messages, session.uid)
  const [delay, setDelay] = useDelaySetting()
  const held = useDelayShield(messages, session.uid, delay)
  const ghost = useGhostCheck()

  return (
    <div className="mx-auto max-w-md lg:flex lg:max-w-6xl lg:justify-center lg:gap-6 lg:px-4">
     <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:max-w-3xl lg:border-x lg:border-line/20">
      <header className="sticky top-0 z-10 space-y-1 border-b border-line/40 bg-night px-4 py-3">
        <a href="#" className="inline-block text-sm font-semibold text-spark">
          Back to rooms
        </a>
        <h1 className="break-words text-lg font-bold leading-6 text-ink">{room.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-plum/20 px-2.5 py-1 font-semibold text-plum">
            {formatTimeLeft(msLeft(room.openedAtMs, now))}
          </span>
          <span className="rounded-full bg-raised px-2.5 py-1 font-semibold text-muted">
            {MATURITY_DISPLAY[room.maturityLabel]}
          </span>
          <span className="flex items-center gap-1.5 font-semibold text-live">
            <LiveDot />
            {room.postingParticipantCount === 0 ? 'No one has posted yet' : `${room.postingParticipantCount} have posted`}
          </span>
        </div>
        <details className="lg:hidden">
          <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-xs font-semibold text-spark">
            {delay === 0 ? 'Delay Shield: off' : `Delay Shield: ${delay} s behind`}
          </summary>
          <DelayControl value={delay} onChange={setDelay} />
        </details>
      </header>

      <main className="flex-1 py-2">
        <MessageList state={msgState} hidden={hidden} held={held} uid={session.uid} />
      </main>

      <div className="sticky bottom-0 z-10 bg-night">
        {demo && (
          <DemoTools
            count={sim.length}
            onChatter={(n, scrollUpFirst) => {
              if (scrollUpFirst) window.scrollTo({ top: 0 })
              setSim((prev) => [...prev, ...simulatedChatter(n, Date.now(), prev.length)])
            }}
            onFlagged={() => setSim((prev) => [...prev, ...simulatedFlagged(Date.now(), prev.length)])}
            onSpoilers={() => setSim((prev) => [...prev, ...simulatedSpoilers(Date.now(), prev.length)])}
            onClear={() => setSim([])}
          />
        )}
        <CatchUpBar unseen={unseen} hidden={hidden} held={held} onJump={scrollToLatest} />
        <MessageComposer
          roomId={roomId}
          uid={session.uid}
          openedAtMs={room.openedAtMs}
          expiresAt={expiresAt}
          createdAtMs={session.createdAtMs}
          ghost={ghost}
        />
      </div>
     </div>

     {/* Wide screens only: the tools sit beside the chat, so the demo can show them while chatting. */}
     <aside className="hidden w-[340px] shrink-0 lg:block">
      <div className="sticky top-0 max-h-screen space-y-4 overflow-y-auto py-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-accent">Room tools</h2>
        <DelayControl value={delay} onChange={setDelay} />
        <GhostStatus ghost={ghost} defaultOpen />
      </div>
     </aside>
    </div>
  )
}

export default function RoomPage({ roomId, session, demo = false }: { roomId: string; session: ReadySession; demo?: boolean }) {
  const state = useRoom(roomId)
  const now = useNow()

  if (state.status === 'loading') return <Notice title="Opening room..." body="One moment." />
  if (state.status === 'error') return <Notice title="Couldn't open the room" body={state.message} />
  if (state.status === 'unavailable')
    return <Notice title="This room has ended" body="It has closed, or it isn't available to this account." />

  // A closed room shows no messages at all.
  if (isExpired(state.room.openedAtMs, now)) return <Notice title="This room has ended" body="Rooms close 24 hours after they open." />

  return <RoomBody roomId={roomId} room={state.room} expiresAt={state.expiresAt} session={session} demo={demo} />
}
