import { useEffect, useRef, useState } from 'react'
import type { MessagesState } from '../hooks/useMessages'
import { useProfiles } from '../hooks/useProfiles'
import { SIM_PROFILES } from '../lib/demoData'
import type { GuardReason } from '../lib/messageGuard'
import { nearBottom } from '../lib/scrollUtils'
import MessageItem from './MessageItem'

export default function MessageList({
  state,
  hidden,
  held,
  uid,
  names,
  myName,
}: {
  state: MessagesState
  hidden: Map<string, GuardReason>
  /** Delay Shield: message id -> milliseconds still held. */
  held: Map<string, number>
  uid: string
  names?: string[]
  myName?: string
}) {
  const messages = state.status === 'ready' ? state.messages : []
  const profiles = useProfiles(messages.filter((m) => !m.simulated).map((m) => m.senderId))
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const [released, setReleased] = useState<Set<string>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)
  const first = useRef(true)
  const last = messages[messages.length - 1]

  useEffect(() => {
    if (!last) return
    // Follow new messages only if the reader is already at the bottom, or the message is theirs.
    // Otherwise the screen stays still so they can read; the "new messages" pill takes over.
    if (first.current || last.senderId === uid || nearBottom()) {
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
    first.current = false
  }, [last?.id, last?.pending, uid]) // eslint-disable-line react-hooks/exhaustive-deps

  if (state.status === 'loading') return <p className="px-4 py-6 text-sm text-muted">Loading messages...</p>
  if (state.status === 'closed') return <p className="px-4 py-6 text-sm text-muted">This room has closed.</p>
  if (state.status === 'error')
    return (
      <p role="alert" className="px-4 py-6 text-sm text-ink">
        {state.message}
      </p>
    )

  return (
    <div className="px-4">
      {messages.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No messages yet. Say something to get it started.</p>
      ) : (
        <ul>
          {messages.map((m) => {
            const reason = hidden.get(m.id)
            return (
              <MessageItem
                key={m.id}
                message={m}
                profile={m.simulated ? SIM_PROFILES[m.senderId] : profiles.get(m.senderId)}
                mine={m.senderId === uid}
                names={names}
                myName={myName}
                hiddenReason={reason?.text}
                hiddenLabel={reason?.label}
                uncertain={reason?.uncertain}
                revealed={revealed.has(m.id)}
                onToggle={() => toggle(m.id)}
                heldSecs={released.has(m.id) ? 0 : (held.get(m.id) ?? 0) / 1000}
                onRelease={() => setReleased((prev) => new Set(prev).add(m.id))}
              />
            )
          })}
        </ul>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
