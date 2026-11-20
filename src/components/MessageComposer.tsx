import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Timestamp } from 'firebase/firestore'
import { useGhostCheck } from '../hooks/useGhostCheck'
import { explainSendError, preCheckSend } from '../lib/messageUtils'
import { sendMessage } from '../lib/sendMessage'
import { MESSAGE_MAX_LENGTH, MESSAGE_MIN_INTERVAL_S } from '../types'
import GhostStatus from './GhostStatus'
import ReviewPanel, { type ReviewState } from './ReviewPanel'

export default function MessageComposer({
  roomId,
  uid,
  openedAtMs,
  expiresAt,
  createdAtMs,
}: {
  roomId: string
  uid: string
  openedAtMs: number
  expiresAt: Timestamp
  createdAtMs: number
}) {
  const ghost = useGhostCheck()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [review, setReview] = useState<ReviewState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cooling, setCooling] = useState(false)
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
    const result = await sendMessage({
      roomId,
      uid,
      messageId: draftId.current,
      body,
      roomExpiresAt: expiresAt,
      openedAtMs,
      createdAtMs,
      lastSentAtMs: lastSent.current,
    })
    setBusy(false)
    if (result.status === 'failed') return setError(explainSendError(result.code))
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
    const problem = preCheckSend({ body: text, nowMs: Date.now(), openedAtMs, lastSentAtMs: lastSent.current, createdAtMs })
    if (problem) return setError(explainSendError(problem))

    const draft = text
    setChecking(true)
    const r = await ghost.review(draft)
    setChecking(false)
    if (r.plan.kind === 'review') {
      setReview({ redactedText: r.plan.redactedText, findingKinds: r.plan.findingKinds, verdict: r.plan.verdict })
      return
    }
    // The AI check was tried but did not finish: say so. (If no check was available at all, the drawer explains.)
    if (['timeout', 'error', 'unclear', 'busy'].includes(r.check.outcome)) setNotice(`Sent without the AI check: ${r.check.note} Plain-code protection still ran.`)
    await doSend(draft)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    ghost.warm()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const empty = text.trim().length === 0

  return (
    <div className="space-y-2 border-t border-line/40 bg-night p-3">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
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
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setReview(null)
            setNotice(null)
            draftId.current = null
          }}
          onKeyDown={onKeyDown}
          onFocus={ghost.warm}
          maxLength={MESSAGE_MAX_LENGTH}
          rows={2}
          aria-label="Message"
          placeholder="Say something..."
          className="min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink focus:border-accent focus:outline-none"
        />
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
        <GhostStatus ghost={ghost} />
        <p className="pt-3 text-xs text-muted">
          {text.length}/{MESSAGE_MAX_LENGTH}
        </p>
      </div>
    </div>
  )
}
