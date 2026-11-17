import AuthGate from './components/AuthGate'
import { useHash } from './hooks/useHash'
import HomePage from './pages/HomePage'
import RoomPlaceholder from './pages/RoomPlaceholder'
import AiSpike from './spike/AiSpike'

export default function App() {
  const hash = useHash()

  // The AI spike stays reachable at /#spike until the real AI features replace it.
  if (hash === '#spike') {
    return (
      <div className="min-h-screen bg-night">
        <AiSpike />
      </div>
    )
  }

  return (
    <AuthGate>
      {(session) => {
        const room = /^#room\/([A-Za-z0-9]+)$/.exec(hash)
        return room ? <RoomPlaceholder roomId={room[1]} /> : <HomePage session={session} />
      }}
    </AuthGate>
  )
}
