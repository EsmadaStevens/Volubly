import { useEffect, useRef, useState } from 'react'
import { EMOJI_GROUPS } from '../lib/emoji'

/** A button that opens a small panel of everyday emoji. Picking one hands it to onPick. */
export default function EmojiPicker({
  onPick,
  disabled,
  defaultOpen = false,
}: {
  onPick: (emoji: string) => void
  disabled?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [groupId, setGroupId] = useState(EMOJI_GROUPS[0].id)
  const wrap = useRef<HTMLDivElement>(null)
  const group = EMOJI_GROUPS.find((g) => g.id === groupId) ?? EMOJI_GROUPS[0]

  // Escape or a tap outside closes the panel.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  return (
    <div ref={wrap}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label="Add an emoji"
        aria-expanded={open}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-line bg-surface text-xl disabled:opacity-50"
      >
        <span aria-hidden="true">😊</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Emoji"
          className="absolute inset-x-3 bottom-full z-20 mb-2 rounded-2xl border border-line bg-raised p-2 shadow-lg sm:left-auto sm:w-80"
        >
          <div className="mb-2 flex gap-1" role="group" aria-label="Emoji groups">
            {EMOJI_GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroupId(g.id)}
                aria-pressed={g.id === group.id}
                aria-label={g.label}
                className={`min-h-[40px] flex-1 rounded-lg text-lg ${g.id === group.id ? 'bg-surface' : ''}`}
              >
                <span aria-hidden="true">{g.icon}</span>
              </button>
            ))}
          </div>
          <p className="mb-1 px-1 text-xs text-muted">{group.label}</p>
          <div className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto">
            {group.emoji.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => onPick(e)}
                aria-label={e}
                className="flex min-h-[44px] items-center justify-center rounded-lg text-2xl hover:bg-surface"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
