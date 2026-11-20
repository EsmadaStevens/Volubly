import { useEffect, useState } from 'react'
import { nearBottom } from '../lib/scrollUtils'
import type { MessageView } from '../types'

/**
 * Messages that arrived while the reader was scrolled up (or looking elsewhere).
 * The screen stays still while they read; this just counts what they have not seen.
 */
export function useUnseen(messages: MessageView[], uid: string): MessageView[] {
  const [anchor, setAnchor] = useState<string | null>(null)
  const last = messages[messages.length - 1]

  useEffect(() => {
    if (!last) return
    if (anchor === null || last.senderId === uid || nearBottom()) setAnchor(last.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id, uid])

  useEffect(() => {
    if (!last) return
    const onScroll = () => {
      if (nearBottom()) setAnchor(last.id)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [last?.id])

  if (anchor === null) return []
  const at = messages.findIndex((m) => m.id === anchor)
  return at < 0 ? [] : messages.slice(at + 1)
}
