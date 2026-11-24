import { useNow } from '../hooks/useNow'
import type { GhostCheck } from '../hooks/useGhostCheck'
import { describeEvent, PURPOSE_NAME, statsText } from '../lib/inferenceView'
import type { Purpose } from '../lib/inferenceLog'

const PURPOSES: Purpose[] = ['send_check', 'read_check', 'catch_up']
const SHOWN = 5

export default function GhostStatus({
  ghost,
  defaultOpen = false,
  compact = false,
}: {
  ghost: GhostCheck
  defaultOpen?: boolean
  /** One row, "Ghost-Mode ... status", that opens into the full panel. Used beside the room tools. */
  compact?: boolean
}) {
  const { snap, cloudConsent, setCloudConsent, progress, turnOnDevice, warming } = ghost
  const now = useNow()
  const online = typeof navigator === 'undefined' ? true : navigator.onLine
  const recent = [...snap.events].reverse().slice(0, SHOWN)

  let pill = 'AI check off'
  if (progress !== null || snap.device === 'downloading') pill = `Downloading model${progress !== null ? ` ${progress}%` : ''}`
  else if (snap.device === 'ready') pill = warming ? 'Waking on-device check...' : 'Checks on this device'
  else if (cloudConsent && online) pill = 'Cloud check on'

  // "AI check off" still has the plain-code checks running, so the compact row calls it "Available".
  const short = pill === 'AI check off' ? 'Available' : pill

  return (
    <details className="text-xs text-muted" open={defaultOpen || undefined}>
      {compact ? (
        <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-xl bg-surface px-3 font-semibold">
          <span className="text-sm font-bold text-ink">Ghost-Mode</span>
          <span className="rounded-full bg-raised px-2.5 py-1 text-plum">{short}</span>
        </summary>
      ) : (
        <summary className="inline-flex min-h-[44px] cursor-pointer items-center rounded-full bg-raised px-3 font-semibold text-plum">
          {pill}
        </summary>
      )}
      <div className="mt-2 space-y-3 rounded-xl bg-surface p-3">
        <p>
          Before you send, we hide phone numbers, emails, passwords and keys using plain code on this device. That
          never needs AI and never leaves your screen. It catches common patterns, not everything.
        </p>

        <p className="text-ink">
          {snap.device === 'ready' && 'AI check: runs on this device, even offline.'}
          {snap.device === 'downloadable' && 'AI check: your browser can run it on this device after a one-time download.'}
          {snap.device === 'downloading' && 'AI check: your browser is still getting its model ready.'}
          {(snap.device === 'unavailable' || snap.device === 'unknown') &&
            "AI check: this browser can't run it on-device (desktop Chrome with the built-in AI turned on is needed)."}
        </p>

        {snap.device === 'downloadable' && progress === null && (
          <button
            type="button"
            onClick={() => void turnOnDevice()}
            className="min-h-[44px] rounded-xl bg-accent px-4 text-sm font-bold text-night"
          >
            Turn on on-device check
          </button>
        )}
        {snap.device === 'downloadable' && <p>This downloads a large model (about 4 GB) once. After that it works offline.</p>}

        <label className="flex min-h-[44px] items-start gap-3 text-ink">
          <input
            type="checkbox"
            checked={cloudConsent}
            onChange={(e) => setCloudConsent(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-accent"
          />
          <span>
            Allow a cloud check when this device can't do it. Your draft, with numbers, emails, passwords and keys
            already hidden, is sent to Google's Gemini through Firebase for that check only.
          </span>
        </label>

        <div className="space-y-1 border-t border-line/40 pt-2">
          <p className="font-bold text-ink">What Ghost-Mode can and can't do</p>
          <p>
            Ghost-Mode uses automated checks to find possibly harmful content. It can miss harmful messages and hide
            harmless ones. You stay in control of what you send and what you show.
          </p>
          <p>
            Hiding happens on your device only. A message hidden for you can still show for someone else, and the other
            way round.
          </p>
          <p>
            Reading checks for insults, threats and similar need desktop Chrome with the built-in AI. On phones and
            other browsers only the plain-code checks run (phone numbers, emails, passwords, keys, links). The cloud
            check, if you allow it, applies only to what you send, never to what you read.
          </p>
        </div>

        <div className="space-y-2 border-t border-line/40 pt-2">
          <p className="font-bold text-ink">Inference activity</p>
          {recent.length === 0 ? (
            <p>Nothing yet this session.</p>
          ) : (
            <ul className="space-y-2">
              {recent.map((e, i) => {
                const v = describeEvent(e, now)
                return (
                  <li key={`${e.at}-${i}`} className="space-y-0.5 rounded-lg bg-night px-3 py-2">
                    <p className="font-bold text-ink">{v.route}</p>
                    <p className="font-semibold text-plum">{v.purpose}</p>
                    <p>
                      {v.when}
                      {v.duration && ` · ${v.duration}`}
                    </p>
                    <p>{v.context}</p>
                    <p className={v.notChecked ? 'text-warn' : 'text-ink'}>Result: {v.result}</p>
                    <p className="text-muted">{v.why}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="space-y-1 border-t border-line/40 pt-2">
          <p className="font-bold text-ink">This session</p>
          {PURPOSES.map((p) => (
            <p key={p}>
              <span className="font-semibold text-ink">{p === 'send_check' ? 'Sender checks' : p === 'read_check' ? 'Reader checks' : 'Catch-ups'}</span>
              {' ('}
              {PURPOSE_NAME[p]}
              {'): '}
              {statsText(snap.stats[p])}
            </p>
          ))}
          <p>A check that timed out or was skipped is counted as "not checked", never as a pass.</p>
        </div>
      </div>
    </details>
  )
}
