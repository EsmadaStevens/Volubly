import { describe, expect, it } from 'vitest'

/**
 * Demo mode (/demo) must stay on the screen. These tests read the source files and fail if the demo code
 * ever touches the database, or if any code that writes to the database ever touches the demo code.
 * The real protection is still Firestore's security rules, which apply to every client whatever the UI shows.
 */
const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const read = (path: string): string => {
  const src = sources[path]
  if (typeof src !== 'string') throw new Error(`${path} not found: update this test if the file moved`)
  return src
}

const WRITE_CALLS = /\b(addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|increment)\b/
const DEMO_ONLY = ['/src/lib/demoData.ts', '/src/components/DemoTools.tsx']
const DB_WRITERS = ['/src/lib/sendMessage.ts', '/src/lib/profileApi.ts', '/src/lib/account.ts', '/src/lib/rooms.ts']

describe('demo mode never reaches the database', () => {
  for (const file of DEMO_ONLY) {
    it(`${file} has no Firebase import and no write call`, () => {
      const src = read(file)
      expect(src).not.toMatch(/from ['"]firebase\//)
      expect(src).not.toMatch(/from ['"][./]*(lib\/)?firebase['"]/)
      expect(src).not.toMatch(WRITE_CALLS)
    })
  }

  for (const file of DB_WRITERS) {
    it(`${file} knows nothing about demo or simulated messages`, () => {
      const src = read(file)
      expect(src).not.toMatch(/demoData|simulated|isSimId|SIM_PROFILES/)
    })
  }

  it('a message read from the database can never claim to be simulated', () => {
    expect(read('/src/lib/messageData.ts')).not.toMatch(/simulated/)
  })

  it('simulated messages exist only in the room screen\'s own memory', () => {
    const room = read('/src/pages/RoomPage.tsx')
    expect(room).toMatch(/useState<MessageView\[\]>\(\[\]\)/)
    expect(room).not.toMatch(WRITE_CALLS)
  })
})
