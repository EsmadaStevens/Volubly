import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Timestamp } from 'firebase/firestore'
import type { GhostCheck } from '../hooks/useGhostCheck'
import { insertAt } from '../lib/emoji'
import { completeMention, mentionQuery, suggestNames } from '../lib/mentions'
import { explainSendError, preCheckSend } from '../lib/messageUtils'
import { sendMessage } from '../lib/sendMessage'
import type { ComposerTarget } from '../lib/whisperTarget'
import { MESSAGE_MAX_LENGTH, MESSAGE_MIN_INTERVAL_S } from '../types'
import EmojiPicker from './EmojiPicker'
import GhostStatus from './GhostStatus'
import ReviewPanel, { type ReviewState } from './ReviewPanel'

interface CommonProps {
  uid: string
  createdAtMs: number
  ghost: GhostCheck
  /** Usernames of people in this room, for @mention suggestions. */
  names?: string[]
  myName?: string
}

/** A room: sends with sendMessage and closes 24 hours after the room opened. */
interface RoomProps extends CommonProps {
  roomId: string
  openedAtMs: number
  expiresAt: Timestamp
  target?: undefined
}

/** Anything else (a whisper): the target says how to check a draft, send it, and word each problem. */
interface TargetProps extends CommonProps {
  target: ComposerTarget
  roomId?: undefined
  openedAtMs?: undefined
  expiresAt?: undefined
}

export type MessageComposerProps = RoomProps | TargetProps

export default function MessageComposer(props: MessageComposerProps) {
  const { uid, createdAtMs, ghost, names = [], myName, target } = props
  const explain = target ? target.explain : explainSendError
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [review, setReview] = useState<ReviewState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cooling, setCooling] = useState(false)
  const [caret, setCaret] = useState(0)
  const [wakeNote, setWakeNote] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const draftId = useRef<string | null>(null)
  const lastSent = useRef<number | null>(null)
  const coolTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(coolTimer.current), [])
  // Opening a room is usually a tap, so wake the on-device model right away if it is already installed.
  const { warm } = ghost
  useEffect(() => {
    warm()
  }, [warm, ghost.snap.device])

  async function doSend(body: string) {
    setReview(null)
    setBusy(true)
    // One id per message: pressing Send again after a doubtful failure cannot post it twice.
    if (!draftId.current) draftId.current = crypto.randomUUID()
    const result = props.target
      ? await props.target.send({ messageId: draftId.current, body, lastSentAtMs: lastSent.current })
      : await sendMessage({
          roomId: props.roomId,
          uid,
          messageId: draftId.current,
          body,
          roomExpiresAt: props.expiresAt,
          openedAtMs: props.openedAtMs,
          createdAtMs,
          lastSentAtMs: lastSent.current,
        })
    setBusy(false)
    if (result.status === 'failed') return setError(explain(result.code))
    lastSent.current = Date.now()
    draftId.current = null
    setText('')
    setCooling(true)
    coolTimer.current = setTimeout(() => setCooling(false), MESSAGE_MIN_INTERVAL_S * 1000)
  }

  async function submit() {
    if (busy || cooling || checking) return
    setError(null)
    setNotice(null)
    setReview(null)
    const problem = props.target
      ? props.target.preCheck(text, lastSent.current)
      : preCheckSend({ body: text, nowMs: Date.now(), openedAtMs: props.openedAtMs, lastSentAtMs: lastSent.current, createdAtMs })
    if (problem) return setError(explain(problem))

    const draft = text
    setChecking(true)
    setWakeNote(ghost.needsWake())
    const r = await ghost.review(draft)
    setChecking(false)
    setWakeNote(false)
    if (r.plan.kind === 'review') {
      setReview({ redactedText: r.plan.redactedText, findingKinds: r.plan.findingKinds, verdict: r.plan.verdict })
      return
    }
    // The AI check was tried but did not finish: say so. (If no check was available at all, the drawer explains.)
    if (['timeout', 'error', 'unclear', 'busy'].includes(r.check.outcome)) setNotice(`Sent without the AI check: ${r.check.note} Plain-code protection still ran.`)
    await doSend(draft)
  }

  /** Any change to the draft: clears an old review and gives the next send a fresh id. */
  function changeText(next: string) {
    setText(next)
    setReview(null)
    setNotice(null)
    draftId.current = null
  }

  const mq = mentionQuery(text, Math.min(caret, text.length))
  const suggestions = mq ? suggestNames(names, mq.query, myName) : []

  function pickMention(name: string) {
    if (!mq) return
    const r = completeMention(text, mq, Math.min(caret, text.length), name, MESSAGE_MAX_LENGTH)
    if (!r) return
    changeText(r.text)
    setCaret(r.cursor)
    const el = box.current
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(r.cursor, r.cursor)
    })
  }

  function addEmoji(emoji: string) {
    const el = box.current
    const at = el ? [el.selectionStart, el.selectionEnd] : [text.length, text.length]
    const r = insertAt(text, at[0], at[1], emoji, MESSAGE_MAX_LENGTH)
    if (!r) return // no room left: the counter already shows why
    changeText(r.text)
    // Put the cursor after the emoji and keep typing without a second tap.
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(r.cursor, r.cursor)
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    ghost.warm()
    // Tab takes the first suggestion. Enter still sends, so a mention never changes what Enter does.
    if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault()
      pickMention(suggestions[0])
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const empty = text.trim().length === 0

  return (
    <div className="relative space-y-2 border-t border-line/40 bg-night p-3">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {checking && wakeNote && (
        <p role="status" className="text-xs text-muted">
          Waking the on-device check. The first one after a quiet spell can take up to 15 seconds. Your message hasn't been sent.
        </p>
      )}
      {notice && <p className="text-xs text-muted">{notice}</p>}
      {review && (
        <ReviewPanel
          review={review}
          onRedactSend={() => review.redactedText !== null && void doSend(review.redactedText)}
          onSendAnyway={() => void doSend(text)}
          onEdit={() => setReview(null)}
        />
      )}
      {suggestions.length > 0 && (
        <ul aria-label="People to mention" className="flex flex-wrap gap-2">
          {suggestions.map((n) => (
            <li key={n}>
              <button
                type="button"
                // Keep focus in the box so the keyboard stays open on a phone.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickMention(n)}
                className="min-h-[44px] rounded-full bg-raised px-4 text-sm font-semibold text-spark"
              >
                @{n}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          value={text}
          onChange={(e) => {
            changeText(e.target.value)
            setCaret(e.target.selectionStart)
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onFocus={ghost.warm}
          maxLength={MESSAGE_MAX_LENGTH}
          rows={2}
          aria-label="Message"
          placeholder="Say something..."
          className="min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink focus:border-accent focus:outline-none"
        />
        <EmojiPicker onPick={addEmoji} disabled={busy || checking} />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || cooling || checking || empty}
          className="min-h-[44px] rounded-xl bg-accent px-5 text-base font-bold text-night disabled:opacity-50"
        >
          {checking ? 'Checking' : busy ? 'Sending' : 'Send'}
        </button>
      </div>
      <div className="flex items-start justify-between gap-2">
        <div className="lg:hidden">
          <GhostStatus ghost={ghost} />
        </div>
        <p className="pt-3 text-xs text-muted">
          {text.length}/{MESSAGE_MAX_LENGTH}
        </p>
      </div>
    </div>
  )
}
