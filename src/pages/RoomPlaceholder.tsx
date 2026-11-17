export default function RoomPlaceholder({ roomId }: { roomId: string }) {
  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <a href="#" className="inline-block min-h-[44px] py-3 text-sm font-semibold text-spark">
        Back to rooms
      </a>
      <h1 className="text-xl font-bold text-ink">Room opened</h1>
      <p className="text-sm text-muted">The chat screen arrives in the next build. Room ID: {roomId}</p>
    </main>
  )
}
