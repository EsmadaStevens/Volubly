import { useMemo, useState, type ReactNode } from 'react'
import type { ReadySession } from '../components/AuthGate'
import GhostStatus from '../components/GhostStatus'
import InviteCard from '../components/InviteCard'
import MessageComposer from '../components/MessageComposer'
import MessageList from '../components/MessageList'
import WaitingCard from '../components/WaitingCard'
import WhisperHeader from '../components/WhisperHeader'
import WhisperNotice from '../components/WhisperNotice'
import { useDeadline } from '../hooks/useCountdown'
import { useGhostCheck } from '../hooks/useGhostCheck'
import { useMessageGuard } from '../hooks/useMessageGuard'
import { useNow } from '../hooks/useNow'
import { useProfiles } from '../hooks/useProfiles'
import { useWhisper } from '../hooks/useWhisper'
import { useWhisperMessages } from '../hooks/useWhisperMessages'
import {
  acceptInvite,
  blockPerson,
  cancelInvite,
  declineInvite,
  endWhisper,
  loadMyWhispers,
  sendWhisperMessage,
  type ActionResult,
} from '../lib/whisperApi'
import {
  ACCOUNT_NOT_ALLOWED,
  BTN_RETRY,
  CHAT_EMPTY,
  INVITE_EXPIRED_TEXT,
  LINK_BACK_WHISPERS,
  WHISPER_ENDED,
  WHISPER_OPENING,
  WHISPER_TITLE,
  WHISPER_UNAVAILABLE,
  blockResult,
} from '../lib/whisperCopy'
import { whispersAllowed } from '../lib/whisperInbox'
import { whisperStage, type Stage } from '../lib/whisperStage'
import { makeWhisperTarget } from '../lib/whisperTarget'
import { THREAD_MS, type WhisperView } from '../lib/whisperTypes'
import type { PublicProfile } from '../types'

const GENERIC: ActionResult = { ok: false, code: 'generic' }
// The Delay Shield is a room feature. A whisper holds nothing back.
const NO_HELD = new Map<string, number>()

const nameOf = (p: PublicProfile | null | undefined) => (p === undefined ? '...' : (p?.username ?? 'Unknown'))

/** The open chat. Exists only while the thread is open, so leaving the open phase drops everything inside it. */
export function OpenChat({
  whisper,
  session,
  otherId,
  profile,
  onClosed,
  onEnd,
  onEndBlock,
  note,
}: {
  whisper: WhisperView
  session: ReadySession
  otherId: string
  profile: PublicProfile | null | undefined
  /** A send was refused just as the hour ended: the page switches to the ended view. */
  onClosed: () => void
  onEnd: () => Promise<ActionResult>
  onEndBlock: () => Promise<ActionResult>
  note: string | null
}) {
  const uid = session.uid
  const endMs = (whisper.acceptedAtMs ?? 0) + THREAD_MS
  // Flips once at the end of the hour, and again on focus or visibility (a timer fires late after sleep).
  const over = useDeadline(endMs)
  // The messages listener exists only until the hour is over.
  const msgState = useWhisperMessages(whisper.id, !over)
  const ghost = useGhostCheck()
  const messages = msgState.status === 'ready' ? msgState.messages : []
  // Reader checks: plain-code patterns and the on-device model only, never the cloud.
  const hidden = useMessageGuard(messages, uid)
  const target = useMemo(
    () => makeWhisperTarget({ whisper, uid, createdAtMs: session.createdAtMs, onClosed, send: sendWhisperMessage }),
    // The target only needs what does not change during a thread; the page re-renders on every snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [whisper.id, whisper.acceptedAtMs, uid, session.createdAtMs],
  )

  // Time is up, or the messages are no longer readable while the document still says open
  // (this device's clock was behind the server). Either way: nothing of the thread stays on screen.
  if (over || msgState.status === 'closed') {
    return <WhisperNotice title={WHISPER_ENDED} body={note ?? undefined} backHref="#whispers" backLabel={LINK_BACK_WHISPERS} />
  }

  const name = nameOf(profile)
  const names = [name, session.profile.username]
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col md:max-w-3xl">
      <WhisperHeader
        name={name}
        avatarSeed={profile?.avatarSeed ?? otherId}
        endMs={endMs}
        onEnd={onEnd}
        onEndBlock={onEndBlock}
      />
      <main className="flex-1 py-2">
        <MessageList
          state={msgState}
          hidden={hidden}
          held={NO_HELD}
          uid={uid}
          names={names}
          myName={session.profile.username}
          closedText={WHISPER_ENDED}
          emptyText={CHAT_EMPTY}
        />
      </main>
      <div className="sticky bottom-0 z-10 bg-night">
        {/* The composer shows its own Ghost-Mode panel on small screens. On wide screens it is hidden there, so it sits here. */}
        <div className="hidden px-3 pt-2 lg:block">
          <GhostStatus ghost={ghost} compact />
        </div>
        <MessageComposer target={target} uid={uid} createdAtMs={session.createdAtMs} ghost={ghost} names={names} myName={session.profile.username} />
      </div>
    </div>
  )
}

export interface WhisperPageViewProps {
  stage: Stage
  whisper: WhisperView | null
  otherId: string
  /** undefined while the profile loads. */
  profile: PublicProfile | null | undefined
  nowMs: number
  /** Said under "This whisper has ended", for example that the person blocked someone. */
  note: string | null
  errorMessage: string
  onRetry: () => void
  actions: {
    accept: (w: WhisperView) => Promise<ActionResult>
    decline: (w: WhisperView) => Promise<ActionResult>
    declineBlock: (w: WhisperView) => Promise<ActionResult>
    cancel: (w: WhisperView) => Promise<ActionResult>
  }
  /** What to show in the open phase. */
  open: ReactNode
}

/** Everything except the open chat, from plain props, so every stage can be rendered without Firebase. */
export function WhisperPageView(p: WhisperPageViewProps) {
  const back = { backHref: '#whispers', backLabel: LINK_BACK_WHISPERS }
  switch (p.stage) {
    case 'loading':
      return (
        <WhisperNotice title={WHISPER_OPENING} {...back}>
          <span role="status" className="sr-only">
            {WHISPER_OPENING}
          </span>
        </WhisperNotice>
      )
    case 'error':
      return (
        <WhisperNotice title={WHISPER_TITLE} {...back}>
          <p role="alert" className="text-sm text-ink">
            {p.errorMessage}
          </p>
          <button type="button" onClick={p.onRetry} className="min-h-[44px] rounded-xl bg-accent px-5 text-base font-bold text-night">
            {BTN_RETRY}
          </button>
        </WhisperNotice>
      )
    case 'unavailable':
      return <WhisperNotice title={WHISPER_UNAVAILABLE} {...back} />
    case 'invite_expired':
      return <WhisperNotice title={INVITE_EXPIRED_TEXT} {...back} />
    case 'ended':
      return <WhisperNotice title={WHISPER_ENDED} body={p.note ?? undefined} {...back} />
    case 'invite_invitee': {
      const w = p.whisper!
      return (
        <WhisperNotice title={WHISPER_TITLE} {...back}>
          <InviteCard
            whisper={w}
            profile={p.profile}
            nowMs={p.nowMs}
            onAccept={() => p.actions.accept(w)}
            onDecline={() => p.actions.decline(w)}
            onDeclineBlock={() => p.actions.declineBlock(w)}
          />
        </WhisperNotice>
      )
    }
    case 'invite_inviter': {
      const w = p.whisper!
      return (
        <WhisperNotice title={WHISPER_TITLE} {...back}>
          <WaitingCard whisper={w} otherId={p.otherId} profile={p.profile} nowMs={p.nowMs} onCancel={() => p.actions.cancel(w)} />
        </WhisperNotice>
      )
    }
    case 'open':
      return <>{p.open}</>
  }
}

function WhisperPageInner({ id, session }: { id: string; session: ReadySession }) {
  const uid = session.uid
  const { state, retry } = useWhisper(id)
  const now = useNow()
  const [forcedEnd, setForcedEnd] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const whisper = state.status === 'ready' ? state.data : null
  const otherId = whisper ? (whisper.inviterId === uid ? whisper.inviteeId : whisper.inviterId) : ''
  const profiles = useProfiles(otherId ? [otherId] : [])
  const profile = otherId ? profiles.get(otherId) : undefined
  const stage = whisperStage({ sub: state, uid, nowMs: now, forcedEnd })

  const actions = {
    // Slot pick needs the person's whisper list: read once when they tap Accept, with no listener.
    accept: async (w: WhisperView): Promise<ActionResult> => {
      const whispers = await loadMyWhispers(uid)
      return whispers ? acceptInvite({ uid, whisper: w, whispers }) : GENERIC
    },
    decline: (w: WhisperView) => declineInvite({ uid, whisper: w }),
    declineBlock: (w: WhisperView) => blockPerson({ uid, otherId: w.inviterId, whisper: w }),
    cancel: (w: WhisperView) => cancelInvite({ uid, whisper: w }),
  }

  const open =
    whisper && stage === 'open' ? (
      <OpenChat
        key={whisper.id}
        whisper={whisper}
        session={session}
        otherId={otherId}
        profile={profile}
        onClosed={() => setForcedEnd(true)}
        onEnd={() => endWhisper({ uid, whisper })}
        onEndBlock={async () => {
          const r = await blockPerson({ uid, otherId, whisper })
          if (r.ok) setNote(blockResult(nameOf(profile)))
          return r
        }}
        note={note}
      />
    ) : null

  return (
    <WhisperPageView
      stage={stage}
      whisper={whisper}
      otherId={otherId}
      profile={profile}
      nowMs={now}
      note={note}
      errorMessage={state.status === 'error' ? state.message : ''}
      onRetry={retry}
      actions={actions}
      open={open}
    />
  )
}

/**
 * The whisper screen (`#whisper/{id}`). The age check comes first, in this wrapper, so an account
 * that may not use whispers never calls a whisper hook and no listener opens.
 */
export default function WhisperPage({ id, session }: { id: string; session: ReadySession }) {
  if (!whispersAllowed(session.ageBand)) {
    return <WhisperNotice title={WHISPER_TITLE} body={ACCOUNT_NOT_ALLOWED} />
  }
  // `key` makes a different whisper start from a clean state (no leftover note or forced end).
  return <WhisperPageInner key={id} id={id} session={session} />
}
