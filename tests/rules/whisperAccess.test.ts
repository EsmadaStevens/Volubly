import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore'
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
  inviteBatch,
  seedBlock,
  seedUser,
  seedWhisper,
  type WhisperStatus,
} from './whisperHelpers.js'

// Reads and lists of whispers, message reads, and the private block list.
// Only the two people can read a thread through the app; it is not end-to-end encrypted.

beforeEach(async () => {
  await clearData()
  const admin = await adminDb()
  for (const uid of ['alice', 'bob', 'carol', 'dave']) await seedUser(admin, uid)
})

afterAll(teardown)

async function seedWithMessage(
  id: string,
  status: WhisperStatus,
  opts: { createdAgeS: number; acceptedAgeS?: number; endedBy?: string },
): Promise<void> {
  const admin = await adminDb()
  const expiresAt = await seedWhisper(admin, id, {
    inviterId: 'alice', inviteeId: 'bob', status, inviterSlot: 1, ...opts,
  })
  await setDoc(doc(admin, 'whispers', id, 'messages', 'm1'), {
    messageId: 'm1', senderId: 'alice', body: 'hello', sentAt: Timestamp.now(), whisperId: id, expiresAt,
  })
}

describe('reading a Whisper', () => {
  it('member read allowed; non-member and unauthenticated read denied', async () => {
    await seedWithMessage('w1', 'requested', { createdAgeS: AGES.pendingValidS })
    await assertFails(getDoc(doc(await userDb('carol'), 'whispers', 'w1')))
    await assertFails(getDoc(doc(await unauthDb(), 'whispers', 'w1')))
    await assertSucceeds(getDoc(doc(await userDb('alice'), 'whispers', 'w1')))
    await assertSucceeds(getDoc(doc(await userDb('bob'), 'whispers', 'w1')))
  })

  it('both members can still read the Whisper after it closed (it holds no message content)', async () => {
    await seedWithMessage('w1', 'ended', { createdAgeS: 70 * 60, acceptedAgeS: AGES.overS, endedBy: 'alice' })
    await assertSucceeds(getDoc(doc(await userDb('alice'), 'whispers', 'w1')))
    await assertSucceeds(getDoc(doc(await userDb('bob'), 'whispers', 'w1')))
  })
})

describe('listing Whispers', () => {
  beforeEach(async () => {
    const admin = await adminDb()
    await seedWhisper(admin, 'w1', {
      inviterId: 'alice', inviteeId: 'bob', status: 'requested', createdAgeS: AGES.pendingValidS, inviterSlot: 1,
    })
    await seedWhisper(admin, 'w2', {
      inviterId: 'carol', inviteeId: 'dave', status: 'requested', createdAgeS: AGES.pendingValidS, inviterSlot: 1,
    })
  })

  it('list with array-contains on own uid allowed, returns only own threads', async () => {
    const db = await userDb('alice')
    const snap = await assertSucceeds(
      getDocs(query(collection(db, 'whispers'), where('memberIds', 'array-contains', 'alice'))),
    )
    expect(snap.docs.map((d) => d.id)).toEqual(['w1'])
  })

  it('list without the constraint denied', async () => {
    await assertFails(getDocs(collection(await userDb('alice'), 'whispers')))
  })

  it("list with another person's uid denied; with own uid allowed", async () => {
    const db = await userDb('alice')
    await assertFails(getDocs(query(collection(db, 'whispers'), where('memberIds', 'array-contains', 'carol'))))
    await assertSucceeds(getDocs(query(collection(db, 'whispers'), where('memberIds', 'array-contains', 'alice'))))
  })

  it('unauthenticated list denied', async () => {
    await assertFails(
      getDocs(query(collection(await unauthDb(), 'whispers'), where('memberIds', 'array-contains', 'alice'))),
    )
  })
})

describe('reading messages', () => {
  it('message read allowed while the thread is open, by both members', async () => {
    await seedWithMessage('w1', 'accepted', { createdAgeS: 40 * 60, acceptedAgeS: AGES.open30S })
    await assertSucceeds(getDoc(doc(await userDb('alice'), 'whispers', 'w1', 'messages', 'm1')))
    await assertSucceeds(getDoc(doc(await userDb('bob'), 'whispers', 'w1', 'messages', 'm1')))
  })

  it('message list allowed while the thread is open', async () => {
    await seedWithMessage('w1', 'accepted', { createdAgeS: 40 * 60, acceptedAgeS: AGES.open30S })
    await assertSucceeds(getDocs(collection(await userDb('alice'), 'whispers', 'w1', 'messages')))
  })

  const closed: [string, WhisperStatus, { createdAgeS: number; acceptedAgeS?: number; endedBy?: string }][] = [
    ['after one hour', 'accepted', { createdAgeS: 70 * 60, acceptedAgeS: AGES.overS }],
    ['after the thread was ended', 'ended', { createdAgeS: 40 * 60, acceptedAgeS: AGES.open30S, endedBy: 'bob' }],
    ['before acceptance', 'requested', { createdAgeS: AGES.pendingValidS }],
    ['for a stale invite', 'requested', { createdAgeS: AGES.pendingStaleS }],
    ['after a decline', 'declined', { createdAgeS: 5 * 60 }],
  ]

  it.each(closed)('message read %s denied for both members; open thread allowed', async (_name, status, opts) => {
    await seedWithMessage('w_closed', status, opts)
    await seedWithMessage('w_open', 'accepted', { createdAgeS: 40 * 60, acceptedAgeS: AGES.open30S })
    for (const who of ['alice', 'bob']) {
      const db = await userDb(who)
      await assertFails(getDoc(doc(db, 'whispers', 'w_closed', 'messages', 'm1')))
      await assertSucceeds(getDoc(doc(db, 'whispers', 'w_open', 'messages', 'm1')))
    }
  })

  it('non-member and unauthenticated message read denied; member allowed', async () => {
    await seedWithMessage('w1', 'accepted', { createdAgeS: 40 * 60, acceptedAgeS: AGES.open30S })
    await assertFails(getDoc(doc(await userDb('carol'), 'whispers', 'w1', 'messages', 'm1')))
    await assertFails(getDoc(doc(await unauthDb(), 'whispers', 'w1', 'messages', 'm1')))
    await assertSucceeds(getDoc(doc(await userDb('alice'), 'whispers', 'w1', 'messages', 'm1')))
  })
})

describe('block entries are private', () => {
  const entry = (blockedId: string) => ({ blockedId, blockedAt: serverTimestamp() })

  it('owner can create, read, update and delete (unblock) their block entry', async () => {
    const db = await userDb('alice')
    const ref = doc(db, 'users', 'alice', 'blocked', 'bob')
    await assertSucceeds(setDoc(ref, entry('bob')))
    await assertSucceeds(getDoc(ref))
    await assertSucceeds(setDoc(ref, entry('bob'))) // update
    await assertSucceeds(deleteDoc(ref))
    const admin = await adminDb()
    expect((await getDoc(doc(admin, 'users', 'alice', 'blocked', 'bob'))).exists()).toBe(false)
  })

  it('another user, including the blocked person, cannot read the entry; the owner can', async () => {
    const admin = await adminDb()
    await seedBlock(admin, 'alice', 'bob')
    await assertFails(getDoc(doc(await userDb('bob'), 'users', 'alice', 'blocked', 'bob')))
    await assertFails(getDoc(doc(await userDb('carol'), 'users', 'alice', 'blocked', 'bob')))
    await assertFails(getDoc(doc(await unauthDb(), 'users', 'alice', 'blocked', 'bob')))
    await assertSucceeds(getDoc(doc(await userDb('alice'), 'users', 'alice', 'blocked', 'bob')))
  })

  it('another user cannot list the block entries; the owner can', async () => {
    const admin = await adminDb()
    await seedBlock(admin, 'alice', 'bob')
    await assertFails(getDocs(collection(await userDb('bob'), 'users', 'alice', 'blocked')))
    await assertSucceeds(getDocs(collection(await userDb('alice'), 'users', 'alice', 'blocked')))
  })

  it('someone else deleting a block entry denied; the owner deleting (unblock) allowed', async () => {
    const admin = await adminDb()
    await seedBlock(admin, 'alice', 'bob')
    await assertFails(deleteDoc(doc(await userDb('bob'), 'users', 'alice', 'blocked', 'bob')))
    await assertFails(deleteDoc(doc(await userDb('carol'), 'users', 'alice', 'blocked', 'bob')))
    expect((await getDoc(doc(admin, 'users', 'alice', 'blocked', 'bob'))).exists()).toBe(true)
    await assertSucceeds(deleteDoc(doc(await userDb('alice'), 'users', 'alice', 'blocked', 'bob')))
  })

  it('someone else creating a block entry in my list denied', async () => {
    await assertFails(setDoc(doc(await userDb('bob'), 'users', 'alice', 'blocked', 'bob'), entry('bob')))
    await assertSucceeds(setDoc(doc(await userDb('alice'), 'users', 'alice', 'blocked', 'bob'), entry('bob')))
  })

  const bad: [string, string, Record<string, unknown>][] = [
    ['blockedId different from the document id', 'bob', { blockedId: 'carol', blockedAt: serverTimestamp() }],
    ['blocking myself', 'alice', { blockedId: 'alice', blockedAt: serverTimestamp() }],
    ['extra field', 'bob', { blockedId: 'bob', blockedAt: serverTimestamp(), extra: 1 }],
    ['missing blockedAt', 'bob', { blockedId: 'bob' }],
    ['blockedAt not request.time', 'bob', { blockedId: 'bob', blockedAt: Timestamp.fromMillis(Date.now() - 5000) }],
  ]

  it.each(bad)('%s denied; valid entry allowed', async (_name, docId, data) => {
    const db = await userDb('alice')
    await assertFails(setDoc(doc(db, 'users', 'alice', 'blocked', docId), data))
    await assertSucceeds(setDoc(doc(db, 'users', 'alice', 'blocked', 'bob'), entry('bob')))
  })
})

describe('denials look the same', () => {
  async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
    try {
      await p
      return undefined
    } catch (err) {
      return (err as { code?: string }).code
    }
  }

  it('a denied invite caused by a block and one caused by an age mismatch both fail with permission-denied', async () => {
    const admin = await adminDb()

    await seedBlock(admin, 'bob', 'alice')
    const blockedCode = await codeOf(
      inviteBatch(await userDb('alice'), { inviterId: 'alice', inviteeId: 'bob', whisperId: 'w1' }).commit(),
    )
    await deleteDoc(doc(admin, 'users', 'bob', 'blocked', 'alice'))

    await seedUser(admin, 'bob', { band: '13_17' })
    const bandCode = await codeOf(
      inviteBatch(await userDb('alice'), { inviterId: 'alice', inviteeId: 'bob', whisperId: 'w1' }).commit(),
    )

    expect(blockedCode).toBe('permission-denied')
    expect(bandCode).toBe('permission-denied')
    expect(blockedCode).toBe(bandCode)

    // Control: with no block and matching bands the same invite succeeds.
    await seedUser(admin, 'bob', { band: '18_plus' })
    await assertSucceeds(
      inviteBatch(await userDb('alice'), { inviterId: 'alice', inviteeId: 'bob', whisperId: 'w1' }).commit(),
    )
  })
})
