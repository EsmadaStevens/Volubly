import type { ReactNode } from 'react'
import { LINK_BACK_ROOMS } from '../lib/whisperCopy'

/** A calm full-page message with a way back. Used by the whisper screens for every non-chat state. */
export default function WhisperNotice({
  title,
  body,
  backHref = '#',
  backLabel = LINK_BACK_ROOMS,
  children,
}: {
  title: string
  body?: string
  backHref?: string
  backLabel?: string
  children?: ReactNode
}) {
  return (
    <main className="mx-auto min-h-screen max-w-md space-y-3 px-4 py-4 md:max-w-xl">
      <a href={backHref} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-spark">
        {backLabel}
      </a>
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      {body && <p className="text-sm text-muted">{body}</p>}
      {children}
    </main>
  )
}
