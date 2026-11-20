import AuthGate from './components/AuthGate'
import { useHash } from './hooks/useHash'
import HomePage from './pages/HomePage'
import RoomPage from './pages/RoomPage'
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
        const room = /^#room\/([A-Za-z0-9]+)(\/demo)?$/.exec(hash)
        return room ? <RoomPage roomId={room[1]} session={session} demo={!!room[2]} /> : <HomePage session={session} />
      }}
    </AuthGate>
  )
}
