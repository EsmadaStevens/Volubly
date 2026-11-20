import type { MessageView } from '../types'

export function toMessageView(id: string, data: Record<string, unknown>, pending: boolean): MessageView | null {
  const sentAt = data.sentAt as { toMillis?: () => number } | null | undefined
  if (!sentAt || typeof sentAt.toMillis !== 'function') return null
  if (typeof data.senderId !== 'string' || typeof data.body !== 'string') return null
  return { id, senderId: data.senderId, body: data.body, sentAtMs: sentAt.toMillis(), pending }
}
