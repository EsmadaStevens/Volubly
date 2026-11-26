import Avatar from './Avatar'
import LiveDot from './LiveDot'

/** The first screen while the app signs in. Small, friendly, and still for people who prefer less motion. */
export default function LoadingScreen({ message = 'Waking up the chat...' }: { message?: string }) {
  return (
    <main role="status" aria-live="polite" className="flex min-h-screen flex-col items-center justify-center gap-5 p-4 text-center">
      <div className="motion-safe:animate-bounce">
        <Avatar seed="volubly-hello" size={88} />
      </div>
      <div className="flex items-center gap-2">
        <LiveDot />
        <span className="text-2xl font-bold tracking-tight text-ink">Volubly</span>
      </div>
      <p className="text-sm text-muted">{message}</p>
      <div aria-hidden="true" className="flex gap-2">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-2.5 w-2.5 rounded-full bg-accent motion-safe:animate-pulse"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </main>
  )
}
