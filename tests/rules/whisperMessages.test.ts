import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore'
import {
  userDb,
  unauthDb,
  adminDb,
  clearData,
  teardown,
  assertFails,
  assertSucceeds,
} from './helpers.js'
import {
  AGES,
  messageBatch,
  seedBlock,
  seedRateLimit,
  seedUser,
  seedWhisper,
  type MessageOptions,
  type WhisperStatus,
} from './whisperHelpers.js'

// alice and bob share whisper w1. Time cannot be moved, so closed threads are planted with
// backdated acceptedAt values (59 versus 61 minutes, never the exact hour).

beforeEach(async () => {
  await clearData()
  const admin = await adminDb()
  await seedUser(admin, 'alice')
  await seedUser(admin, 'bob')
  await seedUser(admin, 'carol')
})

afterAll(teardown)

async function seedThread(
  id: string,
  status: WhisperStatus,
  opts: { acceptedAgeS?: number; createdAgeS?: number; endedBy?: string } = {},
): Promise<void> {
  const admin = await adminDb()
  const accepted = status === 'accepted' || status === 'ended'
  await seedWhisper(admin, id, {
    inviterId: 'alice',
    inviteeId: 'bob',
    status,
    createdAgeS: opts.createdAgeS ?? 70 * 60,
    acceptedAgeS: accepted ? (opts.acceptedAgeS ?? AGES.open30S) : undefined,
    endedBy: opts.endedBy ?? null,
    inviterSlot: 1,
  })
}

async function send(who: string, extra: Partial<MessageOptions> = {}) {
  const db = await userDb(who)
  return (await messageBatch(db, { senderId: who, whisperId: 'w1', ...extra })).commit()
}

async function messageExists(id: string): Promise<boolean> {
  const admin = await adminDb()
  return (await getDoc(doc(admin, 'whispers', 'w1', 'messages', id))).exists()
}

describe('who can send, and when', () => {
  it('message in an accepted thread allowed (both members)', async () => {
    await seedThread('w1', 'accepted')
    await assertSucceeds(send('alice', { messageId: 'm1' }))
    await assertSucceeds(send('bob', { messageId: 'm2' }))
    expect(await messageExists('m1')).toBe(true)
  })

  it('message by a non-member denied; by a member allowed', async () => {
    await seedThread('w1', 'accepted')
    await assertFails(send('carol'))
    expect(await messageExists('msg1')).toBe(false)
    await assertSucceeds(send('alice'))
  })

  it('message before acceptance denied (pending invite); after acceptance allowed', async () => {
    await seedThread('w_req', 'requested', { createdAgeS: AGES.pendingValidS })
    await seedThread('w1', 'accepted')
    const db = await userDb('alice')
    await assertFails((await messageBatch(db, { senderId: 'alice', whisperId: 'w_req' })).commit())
    await assertSucceeds(send('alice'))
  })

  it('message in a declined thread denied', async () => {
    await seedThread('w_dec', 'declined', { createdAgeS: 5 * 60 })
    await seedThread('w1', 'accepted')
    const db = await userDb('bob')
    await assertFails((await messageBatch(db, { senderId: 'bob', whisperId: 'w_dec' })).commit())
    await assertSucceeds(send('bob'))
  })

  it('message 61 minutes after acceptance denied; 59 minutes allowed', async () => {
    await seedThread('w_over', 'accepted', { acceptedAgeS: AGES.overS, createdAgeS: 70 * 60 })
    await seedThread('w1', 'accepted', { acceptedAgeS: AGES.open59S - 120, createdAgeS: 65 * 60 })
    const db = await userDb('alice')
    await assertFails((await messageBatch(db, { senderId: 'alice', whisperId: 'w_over' })).commit())
    await assertSucceeds(send('alice'))
  })

  it.each(['alice', 'bob'])('message after the thread was ended by %s denied (both members); accepted allowed', async (ender) => {
    await seedThread('w_end', 'ended', { endedBy: ender })
    await seedThread('w1', 'accepted')
    for (const who of ['alice', 'bob']) {
      const db = await userDb(who)
      await assertFails((await messageBatch(db, { senderId: who, whisperId: 'w_end' })).commit())
    }
    await assertSucceeds(send('alice'))
  })

  it('unauthenticated message denied', async () => {
    await seedThread('w1', 'accepted')
    await assertFails((await messageBatch(await unauthDb(), { senderId: 'alice', whisperId: 'w1' })).commit())
    await assertSucceeds(send('alice'))
  })
})

describe('blocks stop messages', () => {
  it('message denied when the other member has blocked the sender; the blocker can still send', async () => {
    await seedThread('w1', 'accepted')
    const admin = await adminDb()
    await seedBlock(admin, 'bob', 'alice') // bob blocked alice

    // Denied: alice is blocked by bob.
    await assertFails(send('alice'))
    expect(await messageExists('msg1')).toBe(false)

    // Positive control: bob, the blocker, may still send in the same thread.
    await assertSucceeds(send('bob'))
  })

  it('the same holds in the other direction', async () => {
    await seedThread('w1', 'accepted')
    const admin = await adminDb()
    await seedBlock(admin, 'alice', 'bob') // alice blocked bob
    await assertFails(send('bob'))
    await assertSucceeds(send('alice'))
  })

  it('message allowed again after the block is removed', async () => {
    await seedThread('w1', 'accepted')
    const admin = await adminDb()
    await seedBlock(admin, 'bob', 'alice')
    await assertFails(send('alice'))
    await deleteDoc(doc(admin, 'users', 'bob', 'blocked', 'alice'))
    await assertSucceeds(send('alice'))
  })

  it('a block by a third person does not stop the message', async () => {
    await seedThread('w1', 'accepted')
    const admin = await adminDb()
    await seedBlock(admin, 'carol', 'alice')
    await assertSucceeds(send('alice'))
  })
})

describe('probation and links', () => {
  const links = ['see http://example.com', 'see HTTPS://example.com', 'see www.example.com', 'see WwW.example.com']

  it.each(links)('%s denied in probation; plain text allowed', async (body) => {
    await seedThread('w1', 'accepted')
    const admin = await adminDb()
    await seedUser(admin, 'alice', { ageSeconds: 10 * 60 }) // 10 minutes old
    await assertFails(send('alice', { body }))
    expect(await messageExists('msg1')).toBe(false)
    await assertSucceeds(send('alice', { body: 'see example dot com' }))
  })

  it('a link from an account past probation allowed', async () => {
    await seedThread('w1', 'accepted')
    const admin = await adminDb()
    await seedUser(admin, 'alice', { ageSeconds: 2 * 3600 }) // 2 hours old
    await assertSucceeds(send('alice', { body: 'see https://example.com' }))
  })
})

describe('rate limit', () => {
  it('second message within 3 seconds denied; after a rate limit older than 3 seconds allowed', async () => {
    await seedThread('w1', 'accepted')
    const admin = await adminDb()
    await seedRateLimit(admin, 'w1', 'alice', 1)
    await assertFails(send('alice', { messageId: 'm2' }))
    expect(await messageExists('m2')).toBe(false)
    await seedRateLimit(admin, 'w1', 'alice', 10)
    await assertSucceeds(send('alice', { messageId: 'm2' }))
  })

  it('a message without its rate limit write denied; with it allowed', async () => {
    await seedThread('w1', 'accepted')
    await assertFails(send('alice', { omitRateLimit: true }))
    await assertSucceeds(send('alice'))
  })

  it('a rate limit with a wrong lastMessageAt denied; request.time allowed', async () => {
    await seedThread('w1', 'accepted')
    await assertFails(send('alice', { rateLimitOverrides: { lastMessageAt: Timestamp.fromMillis(Date.now() - 60000) } }))
    await assertSucceeds(send('alice'))
  })

  it("the other member's own limit is independent", async () => {
    await seedThread('w1', 'accepted')
    const admin = await adminDb()
    await seedRateLimit(admin, 'w1', 'alice', 1)
    await assertSucceeds(send('bob'))
  })

  it('rate limit write by another user denied; own write in an open thread allowed', async () => {
    await seedThread('w1', 'accepted')
    const bob = await userDb('bob')
    const expiresAt = (await getDoc(doc(await adminDb(), 'whispers', 'w1'))).data()?.expiresAt
    const data = { userId: 'alice', lastMessageAt: serverTimestamp(), expiresAt }
    await assertFails(setDoc(doc(bob, 'whispers', 'w1', 'rateLimits', 'alice'), data))
    await assertSucceeds(setDoc(doc(bob, 'whispers', 'w1', 'rateLimits', 'bob'), { ...data, userId: 'bob' }))
  })

  it('rate limit write after the thread closed denied; in an open thread allowed', async () => {
    await seedThread('w_end', 'ended', { endedBy: 'bob' })
    await seedThread('w1', 'accepted')
    const alice = await userDb('alice')
    const admin = await adminDb()
    const expClosed = (await getDoc(doc(admin, 'whispers', 'w_end'))).data()?.expiresAt
    const expOpen = (await getDoc(doc(admin, 'whispers', 'w1'))).data()?.expiresAt
    await assertFails(
      setDoc(doc(alice, 'whispers', 'w_end', 'rateLimits', 'alice'), {
        userId: 'alice', lastMessageAt: serverTimestamp(), expiresAt: expClosed,
      }),
    )
    await assertSucceeds(
      setDoc(doc(alice, 'whispers', 'w1', 'rateLimits', 'alice'), {
        userId: 'alice', lastMessageAt: serverTimestamp(), expiresAt: expOpen,
      }),
    )
  })
})

describe('message shape', () => {
  const bad: [string, Partial<MessageOptions>][] = [
    ['empty body', { body: '' }],
    ['281 character body', { body: 'a'.repeat(281) }],
    ['wrong senderId', { messageOverrides: { senderId: 'bob' } }],
    ['wrong messageId', { messageOverrides: { messageId: 'other' } }],
    ['wrong whisperId', { messageOverrides: { whisperId: 'zzz' } }],
    ['sentAt not request.time', { messageOverrides: { sentAt: Timestamp.fromMillis(Date.now() - 5000) } }],
    ['extra field', { messageOverrides: { extra: true } }],
    ['missing field', { messageOverrides: { expiresAt: undefined } }],
    ['body not a string', { messageOverrides: { body: 42 } }],
    ['expiresAt differs from the Whisper expiresAt', { messageOverrides: { expiresAt: Timestamp.fromMillis(Date.now() + 5 * 3600 * 1000) } }],
  ]

  it.each(bad)('%s denied; a 280 character body allowed', async (_name, extra) => {
    await seedThread('w1', 'accepted')
    await assertFails(send('alice', extra))
    expect(await messageExists('msg1')).toBe(false)
    await assertSucceeds(send('alice', { body: 'a'.repeat(280) }))
  })

  it('update and delete of a message denied; the create was allowed', async () => {
    await seedThread('w1', 'accepted')
    await assertSucceeds(send('alice'))
    const ref = doc(await userDb('alice'), 'whispers', 'w1', 'messages', 'msg1')
    await assertFails(updateDoc(ref, { body: 'edited' }))
    await assertFails(deleteDoc(ref))
    expect(await messageExists('msg1')).toBe(true)
  })
})
