import { useState } from 'react'
import { useBusyAction } from '../hooks/useBusyAction'
import { useCountdown } from '../hooks/useCountdown'
import type { ActionResult } from '../lib/whisperApi'
import {
  BTN_END,
  BTN_END_BLOCK,
  BTN_END_CONFIRM,
  BTN_KEEP,
  BUSY,
  LINK_BACK_WHISPERS,
  blockConfirmTitle,
  chatNote,
  countdownLabel,
  endConfirmTitle,
} from '../lib/whisperCopy'
import { formatCountdown } from '../lib/whisperTime'
import Avatar from './Avatar'

/** The one-hour countdown. A component of its own, so its one-second tick does not re-render the message list. */
export function CountdownChip({ endMs }: { endMs: number }) {
  const left = useCountdown(endMs)
  return (
    <span role="timer" className="shrink-0 rounded-full bg-plum/20 px-2.5 py-1 text-xs font-semibold text-plum">
      {countdownLabel(formatCountdown(left))}
    </span>
  )
}

export type Confirm = 'end' | 'block' | null

export interface WhisperHeaderViewProps {
  name: string
  avatarSeed: string
  /** When the hour ends, in milliseconds since 1970. */
  endMs: number
  /** Which confirm row is showing, if any. */
  confirm: Confirm
  busy: string | null
  error: string | null
  finished: boolean
  onAsk: (kind: 'end' | 'block') => void
  onKeep: () => void
  onConfirm: (kind: 'end' | 'block') => void
}

const secondary = 'min-h-[44px] rounded-xl bg-raised px-4 text-sm font-semibold text-ink disabled:opacity-50'
const dangerBtn = 'min-h-[44px] rounded-xl bg-raised px-4 text-sm font-semibold text-danger disabled:opacity-50'

/** Chat header: who, the countdown, how to end it, and what the thread is. */
export function WhisperHeaderView(p: WhisperHeaderViewProps) {
  const off = p.busy !== null || p.finished
  return (
    <header className="sticky top-0 z-10 space-y-2 border-b border-line/40 bg-night px-4 py-3">
      <a href="#whispers" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-spark">
        {LINK_BACK_WHISPERS}
      </a>
      <div className="flex items-center gap-3">
        <Avatar seed={p.avatarSeed} size={36} />
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-ink">{p.name}</h1>
        <CountdownChip endMs={p.endMs} />
      </div>
      <p className="text-xs text-muted">{chatNote(p.name)}</p>

      {p.confirm === null ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => p.onAsk('end')} disabled={off} className={secondary}>
            {BTN_END}
          </button>
          <button type="button" onClick={() => p.onAsk('block')} disabled={off} className={dangerBtn}>
            {BTN_END_BLOCK}
          </button>
        </div>
      ) : (
        <div role="group" aria-label="Confirm" className="space-y-2 rounded-xl bg-surface p-3">
          <p className="text-sm font-bold text-ink">{p.confirm === 'end' ? endConfirmTitle : blockConfirmTitle(p.name)}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => p.onConfirm(p.confirm as 'end' | 'block')}
              disabled={off}
              aria-busy={p.busy !== null}
              className={p.confirm === 'end' ? secondary : dangerBtn}
            >
              {p.busy !== null ? BUSY : p.confirm === 'end' ? BTN_END_CONFIRM : BTN_END_BLOCK}
            </button>
            <button type="button" onClick={p.onKeep} disabled={off} className={secondary}>
              {BTN_KEEP}
            </button>
          </div>
        </div>
      )}

      {p.error && (
        <p role="alert" className="text-sm text-danger">
          {p.error}
        </p>
      )}
    </header>
  )
}

/** The header with its own confirm, busy and error state. The actions come from the page. */
export default function WhisperHeader({
  name,
  avatarSeed,
  endMs,
  onEnd,
  onEndBlock,
}: {
  name: string
  avatarSeed: string
  endMs: number
  onEnd: () => Promise<ActionResult>
  onEndBlock: () => Promise<ActionResult>
}) {
  const [confirm, setConfirm] = useState<Confirm>(null)
  const a = useBusyAction()
  return (
    <WhisperHeaderView
      name={name}
      avatarSeed={avatarSeed}
      endMs={endMs}
      confirm={confirm}
      busy={a.busy}
      error={a.error}
      finished={a.finished}
      onAsk={(kind) => setConfirm(kind)}
      onKeep={() => setConfirm(null)}
      onConfirm={(kind) => void a.run(kind, kind === 'end' ? onEnd : onEndBlock)}
    />
  )
}
