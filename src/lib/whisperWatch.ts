import type { MessagesState } from '../hooks/useMessages'
import type { MessageView } from '../types'
import { toMessageView } from './messageData'
import { toWhisperView } from './whisperData'
import type { WhisperView } from './whisperTypes'

/*
 * The pure parts of the whisper listeners: how a snapshot or an error becomes screen state.
 * No Firebase import, so these are tested directly. The hooks only open the listener and call these.
 * Every hook must read documents with data({ serverTimestamps: 'estimate' }) before calling them.
 */

export type SubState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  /** The rules refused the read, or the document is not there (under these rules a missing document is a refusal too). */
  | { status: 'denied' }
  | { status: 'error'; message: string }

export type Emit<T> = (state: SubState<T>) => void

/** Permission-denied is "not available to you". Any other failure is a connection-type error with a plain message. */
export function toSubError(err: unknown, message: string): SubState<never> {
  const code = (err as { code?: unknown } | null)?.code
  return code === 'permission-denied' ? { status: 'denied' } : { status: 'error', message }
}

export interface RawDoc {
  id: string
  data: Record<string, unknown>
}

/** A list of whisper documents as views. Malformed documents are skipped. */
export function whisperListFrom(docs: RawDoc[]): WhisperView[] {
  const out: WhisperView[] = []
  for (const d of docs) {
    const v = toWhisperView(d.id, d.data)
    if (v) out.push(v)
  }
  return out
}

/** One whisper document. Missing or malformed counts as not available. */
export function whisperFrom(doc: { id: string; exists: boolean; data: Record<string, unknown> | undefined }): SubState<WhisperView> {
  if (!doc.exists || !doc.data) return { status: 'denied' }
  const v = toWhisperView(doc.id, doc.data)
  return v ? { status: 'ready', data: v } : { status: 'denied' }
}

/** Message documents as views, in the order given. Malformed documents are skipped. */
export function messagesFrom(docs: Array<RawDoc & { pending: boolean }>): MessageView[] {
  const out: MessageView[] = []
  for (const d of docs) {
    const m = toMessageView(d.id, d.data, d.pending)
    if (m) out.push(m)
  }
  return out
}

/**
 * The state the shared MessageList understands. Not listening (idle) and a refusal both read as closed,
 * which is what a thread that has ended looks like.
 */
export function messagesStateFrom(sub: SubState<MessageView[]>): MessagesState {
  switch (sub.status) {
    case 'loading':
      return { status: 'loading' }
    case 'ready':
      return { status: 'ready', messages: sub.data }
    case 'error':
      return { status: 'error', message: sub.message }
    case 'idle':
    case 'denied':
      return { status: 'closed' }
  }
}
