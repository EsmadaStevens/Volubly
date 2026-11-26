import { formatClock } from '../lib/messageUtils'
import type { MessageView, PublicProfile } from '../types'
import { splitMentions } from '../lib/mentions'
import Avatar from './Avatar'

export default function MessageItem({
  message,
  profile,
  mine,
  hiddenReason,
  hiddenLabel,
  uncertain = true,
  revealed = false,
  onToggle,
  heldSecs = 0,
  onRelease,
  names = [],
  myName,
  onNameClick,
}: {
  message: MessageView
  profile: PublicProfile | null | undefined
  mine: boolean
  /** Why this message starts hidden on this device, if it does. */
  hiddenReason?: string
  /** Category title for the hidden card, e.g. "Possible threat". */
  hiddenLabel?: string
  /** Adds "it may be wrong" when the reason involves a guess. */
  uncertain?: boolean
  revealed?: boolean
  onToggle?: () => void
  /** Delay Shield: seconds left before this message is shown. Above 0 means it is held back. */
  heldSecs?: number
  /** "Show now" for a held message. */
  onRelease?: () => void
  /** Usernames known in this room, so "@name" can be highlighted. */
  names?: string[]
  /** The reader's own username: a mention of it gets a stronger highlight. */
  myName?: string
  /** Makes the name a button (opens the invite sheet). Left out for the reader's own messages. */
  onNameClick?: () => void
}) {
  const name = profile === undefined ? '...' : (profile?.username ?? 'Unknown')
  const nameIsButton = !!onNameClick && !mine && !!profile
  const collapsed = !!hiddenReason && !revealed
  const held = heldSecs > 0
  const parts = splitMentions(message.body, names, myName)
  const toMe = !mine && parts.some((p) => p.me)
  return (
    <li className={`flex gap-2 py-1.5 ${mine ? 'flex-row-reverse' : ''}`}>
      <Avatar seed={profile?.avatarSeed ?? message.senderId} size={32} />
      <div className={`flex min-w-0 max-w-[80%] flex-col lg:max-w-2xl ${mine ? 'items-end' : 'items-start'}`}>
        <p className="text-xs text-muted">
          {nameIsButton ? (
            // The tap area is stretched to 44px high with a pseudo-element, so the message line stays compact.
            <button
              type="button"
              onClick={onNameClick}
              aria-label={`Open ${name}`}
              className="relative font-bold text-ink underline decoration-dotted underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-[14px] after:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-spark"
            >
              {name}
            </button>
          ) : (
            <span className={`font-bold ${mine ? 'text-accent' : 'text-ink'}`}>{mine ? 'You' : name}</span>
          )}
          {' · '}
          {formatClock(message.sentAtMs)}
          {message.pending && ' · sending'}
          {message.simulated && (
            <span className="ml-2 rounded bg-warn/20 px-1.5 py-0.5 text-[12px] font-bold text-warn">SIMULATED</span>
          )}
        </p>
        {held ? (
          <div className="mt-0.5 rounded-2xl rounded-tl-sm border border-dashed border-spark/50 bg-night px-3 py-2 text-sm text-muted">
            <p>Held back: this might spoil what is happening on your screen. Shows in {Math.ceil(heldSecs)} s.</p>
            <button type="button" onClick={onRelease} className="min-h-[44px] font-bold text-spark underline">
              Show now
            </button>
          </div>
        ) : collapsed ? (
          <div className="mt-0.5 rounded-2xl rounded-tl-sm border border-dashed border-line bg-night px-3 py-2 text-sm text-muted">
            <p className="font-bold text-ink">Message hidden</p>
            {hiddenLabel && <p className="text-xs font-bold uppercase tracking-wide text-warn">{hiddenLabel}</p>}
            <p className="mt-1">
              {hiddenReason}
              {uncertain && ' Checked automatically, so it may be wrong.'}
            </p>
            <p className="mt-1 text-xs">The message stays hidden until you choose to show it.</p>
            <button type="button" onClick={onToggle} className="min-h-[44px] font-bold text-spark underline">
              Show message
            </button>
          </div>
        ) : (
          <>
            {/* Plain text only: links are not made clickable. */}
            <p
              className={`mt-0.5 whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-base text-ink ${
                mine ? 'rounded-tr-sm bg-raised' : 'rounded-tl-sm bg-surface'
              } ${toMe ? 'ring-1 ring-accent/70' : ''}`}
            >
              {parts.map((p, i) =>
                p.mention ? (
                  <span key={i} className={`font-bold ${p.me ? 'rounded bg-accent/20 text-accent' : 'text-spark'}`}>
                    {p.text}
                  </span>
                ) : (
                  p.text
                ),
              )}
            </p>
            {toMe && <span className="text-xs font-semibold text-accent">Mentions you</span>}
            {hiddenReason && (
              <button type="button" onClick={onToggle} className="min-h-[44px] text-xs font-bold text-spark underline">
                Hide again
              </button>
            )}
          </>
        )}
      </div>
    </li>
  )
}
