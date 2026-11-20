/** True when the page is scrolled to (or very near) the newest message. */
export function nearBottom(): boolean {
  return window.innerHeight + window.scrollY >= document.body.scrollHeight - 160
}

export function scrollToLatest(): void {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
}
