import { useEffect, useRef, useState } from 'react'
import type { ReadySession } from './AuthGate'
import Avatar from './Avatar'
import { useBusyAction } from '../hooks/useBusyAction'
import { useProfiles } from '../hooks/useProfiles'
import { useWhispers } from '../hooks/useWhispers'
import { hasBlocked, sendInvite, unblockPerson } from '../lib/whisperApi'
import {
  BTN_CLOSE,
  BTN_INVITE,
  BTN_RETRY,
  BTN_UNBLOCK,
  BUSY,
  GENERIC_ERROR_TEXT,
  LINK_OPEN_WHISPER,
  LINK_OPEN_WHISPERS,
  SHEET_LOADING,
  SHEET_NOTE,
  SHEET_SENDING,
  inviteSent,
  sheetBlocked,
  sheetExisting,
} from '../lib/whisperCopy'
import { newWhisperId } from '../lib/whisperIds'
import { relationWith, type Relation } from '../lib/whisperInbox'
import { personSheetState, type PersonSheetStateName } from '../lib/personSheetState'

const primary = 'min-h-[44px] rounded-xl bg-accent px-5 text-base font-bold text-night disabled:opacity-50'
const secondary = 'min-h-[44px] rounded-xl bg-raised px-4 text-sm font-semibold text-ink disabled:opacity-50'

export interface PersonSheetViewProps {
  state: PersonSheetStateName
  name: string
  avatarSeed: string
  relation: Relation
  /** Plain-language error from the last try, or null. */
  error: string | null
  /** False when the person's whisper list could not be loaded: Invite is replaced by Try again. */
  canInvite: boolean
  /** True while Unblock is running. */
  unblocking: boolean
  onInvite: () => void
  onUnblock: () => void
  onRetry: () => void
  onClose: () => void
}

/** The invite sheet from plain props, so every state can be rendered without Firebase. */
export function PersonSheetView(p: PersonSheetViewProps) {
  const showNote = p.state === 'ready' || p.state === 'failed' || p.state === 'sending'
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-night/80 sm:items-center" onClick={p.onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Invite ${p.name}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-t-2xl bg-surface p-4 sm:rounded-2xl"
      >
        <div className="flex items-center gap-3">
          <Avatar seed={p.avatarSeed} size={48} />
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-ink">{p.name}</h2>
          <button type="button" onClick={p.onClose} className={secondary}>
            {BTN_CLOSE}
          </button>
        </div>

        {p.state === 'loading' && (
          <p role="status" className="text-sm text-muted">
            {SHEET_LOADING}
          </p>
        )}

        {(p.state === 'ready' || p.state === 'failed') &&
          (p.canInvite ? (
            <button type="button" onClick={p.onInvite} className={primary}>
              {BTN_INVITE}
            </button>
          ) : (
            <button type="button" onClick={p.onRetry} className={primary}>
              {BTN_RETRY}
            </button>
          ))}

        {p.state === 'sending' && (
          <button type="button" disabled aria-busy="true" className={primary}>
            {SHEET_SENDING}
          </button>
        )}

        {p.state === 'sent' && (
          <div className="space-y-2">
            <p role="status" className="text-sm text-ink">
              {inviteSent(p.name)}
            </p>
            <a href="#whispers" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-spark">
              {LINK_OPEN_WHISPERS}
            </a>
          </div>
        )}

        {p.state === 'blocked' && (
          <div className="space-y-2">
            <p className="text-sm text-ink">{sheetBlocked(p.name)}</p>
            <button type="button" onClick={p.onUnblock} disabled={p.unblocking} aria-busy={p.unblocking} className={secondary}>
              {p.unblocking ? BUSY : BTN_UNBLOCK}
            </button>
          </div>
        )}

        {p.state === 'existing' && p.relation.kind !== 'none' && (
          <div className="space-y-2">
            <p className="text-sm text-ink">{sheetExisting(p.name, p.relation.kind)}</p>
            <a href={`#whisper/${p.relation.id}`} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-spark">
              {LINK_OPEN_WHISPER}
            </a>
          </div>
        )}

        {p.error && (
          <p role="alert" className="text-sm text-danger">
            {p.error}
          </p>
        )}

        {showNote && <p className="text-xs text-muted">{SHEET_NOTE}</p>}
      </div>
    </div>
  )
}

/**
 * Opened from a name in a room. It shows who, and offers one invite. It reads the person's whisper
 * list while it is open (one listener, closed with the sheet) and checks once whether this person
 * has been blocked. The whisper id is made once per sheet, so a retry cannot create a second whisper.
 */
export default function PersonSheet({ person, session, onClose }: { person: string; session: ReadySession; onClose: () => void }) {
  const uid = session.uid
  const profile = useProfiles([person]).get(person)
  const { state: list, retry } = useWhispers(uid)
  // undefined: still checking. null: could not check (treated as not blocked; the rules decide).
  const [blockedState, setBlockedState] = useState<boolean | null | undefined>(undefined)
  const [sent, setSent] = useState(false)
  const whisperId = useRef<string | null>(null)
  if (whisperId.current === null) whisperId.current = newWhisperId()
  const invite = useBusyAction()
  const unblock = useBusyAction()

  useEffect(() => {
    let cancelled = false
    void hasBlocked(uid, person).then((b) => {
      if (!cancelled) setBlockedState(b)
    })
    return () => {
      cancelled = true
    }
  }, [uid, person])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const whispers = list.status === 'ready' ? list.data : []
  const listFailed = list.status === 'error' || list.status === 'denied'
  const loaded = blockedState !== undefined && (list.status === 'ready' || listFailed)
  const relation = relationWith(whispers, uid, person, Date.now())
  const error = invite.error ?? unblock.error ?? (listFailed ? GENERIC_ERROR_TEXT : null)

  const state = personSheetState({
    loaded,
    blocked: blockedState === true,
    relation,
    sending: invite.busy !== null,
    sent,
    error,
  })

  const name = profile === undefined ? '...' : (profile?.username ?? 'Unknown')
  return (
    <PersonSheetView
      state={state}
      name={name}
      avatarSeed={profile?.avatarSeed ?? person}
      relation={relation}
      error={error}
      canInvite={!listFailed}
      unblocking={unblock.busy !== null}
      onInvite={() =>
        void invite
          .run('invite', () => sendInvite({ uid, inviteeId: person, whisperId: whisperId.current!, whispers }))
          .then((r) => {
            if (r?.ok) setSent(true)
          })
      }
      onUnblock={() =>
        void unblock.run('unblock', () => unblockPerson({ uid, otherId: person })).then((r) => {
          if (r?.ok) setBlockedState(false)
        })
      }
      onRetry={retry}
      onClose={onClose}
    />
  )
}
