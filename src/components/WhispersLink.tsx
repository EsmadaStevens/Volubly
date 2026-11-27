import { useWhispers } from '../hooks/useWhispers'
import { useNow } from '../hooks/useNow'
import { pendingInviteCount, whispersAllowed } from '../lib/whisperInbox'
import { LINK_WHISPERS, whispersLinkName } from '../lib/whisperCopy'
import type { AgeBandLabel } from '../types'

/** The link itself. `pending` is the number of invites waiting for an answer. */
export function WhispersLinkView({ pending }: { pending: number }) {
  return (
    <a
      href="#whispers"
      aria-label={whispersLinkName(pending)}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-3 text-sm font-semibold text-spark"
    >
      {LINK_WHISPERS}
      {pending > 0 && (
        <span aria-hidden="true" className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-night">
          {pending}
        </span>
      )}
    </a>
  )
}

function Counted({ uid }: { uid: string }) {
  const { state } = useWhispers(uid)
  const now = useNow()
  const pending = state.status === 'ready' ? pendingInviteCount(state.data, uid, now) : 0
  return <WhispersLinkView pending={pending} />
}

/**
 * The Home header link, with the number of pending invites. Accounts that may not use whispers
 * get no link and no whisper read: the check happens before any whisper hook is called.
 */
export default function WhispersLink({ uid, ageBand }: { uid: string; ageBand: AgeBandLabel }) {
  if (!whispersAllowed(ageBand)) return null
  return <Counted uid={uid} />
}
