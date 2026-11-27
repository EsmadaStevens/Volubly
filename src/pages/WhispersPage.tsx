import { useMemo } from 'react'
import type { ReadySession } from '../components/AuthGate'
import InviteCard from '../components/InviteCard'
import WhisperNotice from '../components/WhisperNotice'
import WhisperRow from '../components/WhisperRow'
import { useNow } from '../hooks/useNow'
import { useProfiles } from '../hooks/useProfiles'
import { useWhispers } from '../hooks/useWhispers'
import {
  acceptInvite,
  blockPerson,
  cancelInvite,
  declineInvite,
  type ActionResult,
} from '../lib/whisperApi'
import {
  ACCOUNT_NOT_ALLOWED,
  BTN_RETRY,
  INBOX_EMPTY,
  INBOX_ERROR,
  INBOX_LOADING,
  INBOX_TITLE,
  LINK_BACK_ROOMS,
  SECTION_INVITES,
  SECTION_OPEN,
  SECTION_WAITING,
} from '../lib/whisperCopy'
import { buildInbox, whispersAllowed, type Inbox } from '../lib/whisperInbox'
import type { WhisperView } from '../lib/whisperTypes'
import type { PublicProfile } from '../types'

/** What the Inbox can do to a whisper. Each call is bounded and returns a result, never throws. */
export interface InboxActions {
  accept: (w: WhisperView) => Promise<ActionResult>
  decline: (w: WhisperView) => Promise<ActionResult>
  declineBlock: (w: WhisperView) => Promise<ActionResult>
  cancel: (w: WhisperView) => Promise<ActionResult>
}

export interface WhispersViewProps {
  status: 'loading' | 'error' | 'ready'
  errorMessage?: string
  inbox: Inbox
  uid: string
  /** Shared profile cache: undefined while a profile is loading. */
  profiles: Map<string, PublicProfile | null>
  nowMs: number
  actions: InboxActions
  onRetry: () => void
  /** Called after an accept succeeded. */
  onAccepted: (w: WhisperView) => void
}

const otherOf = (w: WhisperView, uid: string) => (w.inviterId === uid ? w.inviteeId : w.inviterId)

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-accent">{title}</h2>
      <ul className="space-y-3">{children}</ul>
    </section>
  )
}

/** The Inbox screen from plain props, so every state can be rendered without Firebase. */
export function WhispersView(p: WhispersViewProps) {
  const empty = p.inbox.invites.length === 0 && p.inbox.open.length === 0 && p.inbox.waiting.length === 0
  return (
    <main className="mx-auto min-h-screen max-w-md space-y-5 px-4 py-4 md:max-w-xl">
      <a href="#" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-spark">
        {LINK_BACK_ROOMS}
      </a>
      <h1 className="text-xl font-bold text-ink">{INBOX_TITLE}</h1>

      {p.status === 'loading' && (
        <p role="status" className="text-sm text-muted">
          {INBOX_LOADING}
        </p>
      )}

      {p.status === 'error' && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-ink">
            {p.errorMessage ?? INBOX_ERROR}
          </p>
          <button
            type="button"
            onClick={p.onRetry}
            className="min-h-[44px] rounded-xl bg-accent px-5 text-base font-bold text-night"
          >
            {BTN_RETRY}
          </button>
        </div>
      )}

      {p.status === 'ready' && empty && <p className="text-sm text-muted">{INBOX_EMPTY}</p>}

      {p.status === 'ready' && p.inbox.invites.length > 0 && (
        <Section title={SECTION_INVITES}>
          {p.inbox.invites.map((w) => (
            <li key={w.id}>
              <InviteCard
                whisper={w}
                profile={p.profiles.get(w.inviterId)}
                nowMs={p.nowMs}
                onAccept={() => p.actions.accept(w)}
                onDecline={() => p.actions.decline(w)}
                onDeclineBlock={() => p.actions.declineBlock(w)}
                onAccepted={() => p.onAccepted(w)}
              />
            </li>
          ))}
        </Section>
      )}

      {p.status === 'ready' && p.inbox.open.length > 0 && (
        <Section title={SECTION_OPEN}>
          {p.inbox.open.map((w) => {
            const other = otherOf(w, p.uid)
            return (
              <li key={w.id}>
                <WhisperRow
                  whisper={w}
                  variant="open"
                  otherId={other}
                  profile={p.profiles.get(other)}
                  nowMs={p.nowMs}
                  onCancel={() => p.actions.cancel(w)}
                />
              </li>
            )
          })}
        </Section>
      )}

      {p.status === 'ready' && p.inbox.waiting.length > 0 && (
        <Section title={SECTION_WAITING}>
          {p.inbox.waiting.map((w) => {
            const other = otherOf(w, p.uid)
            return (
              <li key={w.id}>
                <WhisperRow
                  whisper={w}
                  variant="waiting"
                  otherId={other}
                  profile={p.profiles.get(other)}
                  nowMs={p.nowMs}
                  onCancel={() => p.actions.cancel(w)}
                />
              </li>
            )
          })}
        </Section>
      )}
    </main>
  )
}

function WhispersPageInner({ session }: { session: ReadySession }) {
  const uid = session.uid
  const { state, retry } = useWhispers(uid)
  const now = useNow()
  const whispers = useMemo(() => (state.status === 'ready' ? state.data : []), [state])
  const inbox = useMemo(() => buildInbox(whispers, uid, now), [whispers, uid, now])
  const profiles = useProfiles([...inbox.invites, ...inbox.open, ...inbox.waiting].map((w) => otherOf(w, uid)))

  const actions: InboxActions = {
    accept: (w) => acceptInvite({ uid, whisper: w, whispers }),
    decline: (w) => declineInvite({ uid, whisper: w }),
    // "Decline and block": the decline and the block entry go in one batch.
    declineBlock: (w) => blockPerson({ uid, otherId: w.inviterId, whisper: w }),
    cancel: (w) => cancelInvite({ uid, whisper: w }),
  }

  const status = state.status === 'ready' ? 'ready' : state.status === 'error' || state.status === 'denied' ? 'error' : 'loading'
  return (
    <WhispersView
      status={status}
      errorMessage={state.status === 'error' ? state.message : INBOX_ERROR}
      inbox={inbox}
      uid={uid}
      profiles={profiles}
      nowMs={now}
      actions={actions}
      onRetry={retry}
      onAccepted={(w) => {
        window.location.hash = `#whisper/${w.id}`
      }}
    />
  )
}

/**
 * The Inbox (`#whispers`). The age check comes first, in this wrapper, so an account that may not
 * use whispers never calls a whisper hook and no listener opens.
 */
export default function WhispersPage({ session }: { session: ReadySession }) {
  if (!whispersAllowed(session.ageBand)) {
    return <WhisperNotice title={INBOX_TITLE} body={ACCOUNT_NOT_ALLOWED} />
  }
  return <WhispersPageInner session={session} />
}
