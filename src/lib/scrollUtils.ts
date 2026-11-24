/** True when the page is scrolled to (or very near) the newest message. */
export function nearBottom(): boolean {
  return window.innerHeight + window.scrollY >= document.body.scrollHeight - 160
}

export function scrollToLatest(): void {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
}

/**
 * Everything after the last message the reader had seen. A room only keeps its latest 200
 * messages loaded, so a busy room can slide the anchor off the front while someone is away.
 * In that case everything still loaded is newer than the anchor, so all of it is unseen.
 */
export function messagesAfter<T extends { id: string }>(messages: T[], anchorId: string | null): T[] {
  if (anchorId === null) return []
  const at = messages.findIndex((m) => m.id === anchorId)
  return at < 0 ? messages : messages.slice(at + 1)
}
