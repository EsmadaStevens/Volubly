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
  updateDoc,
  where,
  writeBatch,
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
  acceptBatch,
  inviteBatch,
  seedUser,
  seedWhisper,
  seedWhisperSlot,
  type InviteOptions,
  type SeedWhisperOptions,
} from './whisperHelpers.js'

// The cap limits spam, not a hard guarantee: anonymous accounts can be recreated.

const MIN_MS = 60 * 1000

beforeEach(async () => {
  await clearData()
  const admin = await adminDb()
  await seedUser(admin, 'alice')
  await seedUser(admin, 'bob')
})

afterAll(teardown)

function invite(db: Parameters<typeof inviteBatch>[0], extra: Partial<InviteOptions> = {}) {
  return inviteBatch(db, { inviterId: 'alice', inviteeId: 'bob', whisperId: 'w1', ...extra })
}

async function docExists(...path: [string, ...string[]]): Promise<boolean> {
  const admin = await adminDb()
  const [first, ...rest] = path
  return (await getDoc(doc(admin, first, ...rest))).exists()
}

describe('a slot write must be paired with a Whisper create or accept', () => {
  it('slot alone (Whisper does not exist) denied; the same slot inside an invite batch allowed', async () => {
    const db = await userDb('alice')
    const lone = {
      userId: 'alice',
      whisperId: 'w1',
      openedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 90 * MIN_MS),
    }
    await assertFails(setDoc(doc(db, 'whisperSlots', 'alice_1'), lone))
    expect(await docExists('whisperSlots', 'alice_1')).toBe(false)
    await assertSucceeds(invite(db).commit())
  })

  it('slot alone pointing at an existing pending Whisper denied; invite batch allowed', async () => {
    const admin = await adminDb()
    const expiresAt = await seedWhisper(admin, 'old', {
      inviterId: 'alice', inviteeId: 'bob', status: 'requested',
      createdAgeS: AGES.pendingValidS, inviterSlot: 2,
    })
    const db = await userDb('alice')
    await assertFails(
      setDoc(doc(db, 'whisperSlots', 'alice_2'), {
        userId: 'alice', whisperId: 'old', openedAt: serverTimestamp(), expiresAt,
      }),
    )
    await assertSucceeds(invite(db).commit())
  })

  it('slot written in a decline batch denied; the decline alone allowed', async () => {
    const admin = await adminDb()
    const expiresAt = await seedWhisper(admin, 'w1', {
      inviterId: 'alice', inviteeId: 'bob', status: 'requested',
      createdAgeS: AGES.pendingValidS, inviterSlot: 1,
    })
    const db = await userDb('bob')
    const bad = writeBatch(db)
    bad.update(doc(db, 'whispers', 'w1'), { status: 'declined' })
    bad.set(doc(db, 'whisperSlots', 'bob_1'), {
      userId: 'bob', whisperId: 'w1', openedAt: serverTimestamp(), expiresAt,
    })
    await assertFails(bad.commit())
    expect(await docExists('whisperSlots', 'bob_1')).toBe(false)

    const good = writeBatch(db)
    good.update(doc(db, 'whispers', 'w1'), { status: 'declined' })
    await assertSucceeds(good.commit())
  })

  it('slot written in an end batch denied; the end alone allowed', async () => {
    const admin = await adminDb()
    const expiresAt = await seedWhisper(admin, 'w1', {
      inviterId: 'alice', inviteeId: 'bob', status: 'accepted',
      createdAgeS: 35 * 60, acceptedAgeS: AGES.open30S, inviterSlot: 1,
    })
    const db = await userDb('alice')
    const bad = writeBatch(db)
    bad.update(doc(db, 'whispers', 'w1'), { status: 'ended', endedBy: 'alice' })
    bad.set(doc(db, 'whisperSlots', 'alice_2'), {
      userId: 'alice', whisperId: 'w1', openedAt: serverTimestamp(), expiresAt,
    })
    await assertFails(bad.commit())
    expect(await docExists('whisperSlots', 'alice_2')).toBe(false)

    const good = writeBatch(db)
    good.update(doc(db, 'whispers', 'w1'), { status: 'ended', endedBy: 'alice' })
    await assertSucceeds(good.commit())
  })

  it('a Whisper create without its slot denied; with the slot allowed', async () => {
    const db = await userDb('alice')
    await assertFails(invite(db, { omitSlot: true }).commit())
    expect(await docExists('whispers', 'w1')).toBe(false)
    await assertSucceeds(invite(db).commit())
  })
})

describe('slot shape', () => {
  const bad: [string, Partial<InviteOptions>][] = [
    ['expiresAt differs from the Whisper expiresAt', { slotOverrides: { expiresAt: Timestamp.fromMillis(Date.now() + 120 * MIN_MS) } }],
    ['extra field', { slotOverrides: { extra: true } }],
    ['missing field', { slotOverrides: { expiresAt: undefined } }],
    ['openedAt not request.time', { slotOverrides: { openedAt: Timestamp.fromMillis(Date.now() - 5000) } }],
    ['userId of another user', { slotOverrides: { userId: 'bob' } }],
    ['empty whisperId', { slotOverrides: { whisperId: '' } }],
    ['whisperId not a string', { slotOverrides: { whisperId: 7 } }],
    ['slot id outside 1 to 3', { slotId: 'alice_4' }],
    ['slot id of another user', { slotId: 'bob_1' }],
  ]

  it.each(bad)('%s denied, valid control allowed', async (_name, extra) => {
    const db = await userDb('alice')
    await assertFails(invite(db, extra).commit())
    expect(await docExists('whispers', 'w1')).toBe(false)
    await assertSucceeds(invite(db).commit())
  })

  it('slot expiresAt equal to the Whisper expiresAt allowed (control for the mismatch)', async () => {
    const same = Timestamp.fromMillis(Date.now() + 100 * MIN_MS)
    await assertSucceeds(
      invite(await userDb('alice'), { whisperOverrides: { expiresAt: same }, slotOverrides: { expiresAt: same } }).commit(),
    )
  })

  it('unauthenticated slot write denied', async () => {
    await assertFails(
      setDoc(doc(await unauthDb(), 'whisperSlots', 'alice_1'), {
        userId: 'alice', whisperId: 'w1', openedAt: serverTimestamp(), expiresAt: Timestamp.now(),
      }),
    )
  })
})

describe('one slot cannot satisfy two Whisper creates', () => {
  function whisperData(id: string, inviterSlot: number, expiresAt: Timestamp) {
    return {
      inviterId: 'alice',
      inviteeId: 'bob',
      memberIds: ['alice', 'bob'],
      status: 'requested',
      createdAt: serverTimestamp(),
      acceptedAt: null,
      endedBy: null,
      inviterSlot,
      inviteeSlot: null,
      expiresAt,
      _id: id,
    }
  }

  function strip<T extends { _id: string }>(d: T): Omit<T, '_id'> {
    const { _id, ...rest } = d
    void _id
    return rest
  }

  it('two creates with one slot denied, nothing written; two creates with two slots allowed', async () => {
    const db = await userDb('alice')
    const expiresAt = Timestamp.fromMillis(Date.now() + 90 * MIN_MS)
    const slot = (id: string) => ({
      userId: 'alice', whisperId: id, openedAt: serverTimestamp(), expiresAt,
    })

    const one = writeBatch(db)
    one.set(doc(db, 'whispers', 'w1'), strip(whisperData('w1', 1, expiresAt)))
    one.set(doc(db, 'whispers', 'w2'), strip(whisperData('w2', 1, expiresAt)))
    one.set(doc(db, 'whisperSlots', 'alice_1'), slot('w1'))
    await assertFails(one.commit())
    expect(await docExists('whispers', 'w1')).toBe(false)
    expect(await docExists('whispers', 'w2')).toBe(false)
    expect(await docExists('whisperSlots', 'alice_1')).toBe(false)

    const two = writeBatch(db)
    two.set(doc(db, 'whispers', 'w1'), strip(whisperData('w1', 1, expiresAt)))
    two.set(doc(db, 'whispers', 'w2'), strip(whisperData('w2', 2, expiresAt)))
    two.set(doc(db, 'whisperSlots', 'alice_1'), slot('w1'))
    two.set(doc(db, 'whisperSlots', 'alice_2'), slot('w2'))
    await assertSucceeds(two.commit())
    expect(await docExists('whispers', 'w2')).toBe(true)
  })
})

describe('slot reuse', () => {
  type Prev = Pick<SeedWhisperOptions, 'status' | 'createdAgeS' | 'acceptedAgeS' | 'endedBy'>

  async function holdSlot1(prev: Prev | null): Promise<void> {
    const admin = await adminDb()
    if (prev) {
      await seedWhisper(admin, 'prev', { inviterId: 'alice', inviteeId: 'bob', inviterSlot: 1, ...prev })
    }
    await seedWhisperSlot(admin, 'alice', 1, { whisperId: 'prev', ageSeconds: prev?.createdAgeS ?? 3600 })
  }

  const over: [string, Prev | null][] = [
    ['after the invitee declined', { status: 'declined', createdAgeS: 5 * 60 }],
    ['after the inviter cancelled', { status: 'ended', createdAgeS: 5 * 60, endedBy: 'alice' }],
    ['after a stale invite (16 minutes)', { status: 'requested', createdAgeS: AGES.pendingStaleS }],
    ['after the hour (accepted 61 minutes ago)', { status: 'accepted', createdAgeS: 70 * 60, acceptedAgeS: AGES.overS }],
    ['after an early end', { status: 'ended', createdAgeS: 40 * 60, acceptedAgeS: AGES.open30S, endedBy: 'bob' }],
    ['when the previous Whisper no longer exists (cleanup)', null],
  ]

  it.each(over)('slot reusable %s', async (_name, prev) => {
    await holdSlot1(prev)
    await assertSucceeds(invite(await userDb('alice'), { whisperId: 'w2', inviterSlot: 1 }).commit())
    const admin = await adminDb()
    expect((await getDoc(doc(admin, 'whisperSlots', 'alice_1'))).data()?.whisperId).toBe('w2')
  })

  const open: [string, Prev][] = [
    ['while the invite is pending (14 minutes)', { status: 'requested', createdAgeS: AGES.pendingValidS }],
    ['while the thread is open (accepted 30 minutes ago)', { status: 'accepted', createdAgeS: 35 * 60, acceptedAgeS: AGES.open30S }],
  ]

  it.each(open)('slot NOT reusable %s; reusable once the thread is over', async (_name, prev) => {
    await holdSlot1(prev)
    const db = await userDb('alice')
    await assertFails(invite(db, { whisperId: 'w2', inviterSlot: 1 }).commit())
    expect(await docExists('whispers', 'w2')).toBe(false)
    const admin = await adminDb()
    expect((await getDoc(doc(admin, 'whisperSlots', 'alice_1'))).data()?.whisperId).toBe('prev')

    // Control: the same attempt once the previous thread has been ended.
    await updateDoc(doc(admin, 'whispers', 'prev'), { status: 'ended', endedBy: 'alice' })
    await assertSucceeds(invite(db, { whisperId: 'w2', inviterSlot: 1 }).commit())
  })

  it('reuse that keeps the stored whisperId denied; a new whisperId allowed', async () => {
    await holdSlot1({ status: 'ended', createdAgeS: 5 * 60, endedBy: 'alice' })
    const db = await userDb('alice')
    await assertFails(
      setDoc(doc(db, 'whisperSlots', 'alice_1'), {
        userId: 'alice', whisperId: 'prev', openedAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 90 * MIN_MS),
      }),
    )
    await assertSucceeds(invite(db, { whisperId: 'w2', inviterSlot: 1 }).commit())
  })

  it('the slot own expiresAt is ignored: an old slot with a future expiresAt is still blocked', async () => {
    const admin = await adminDb()
    const exp = await seedWhisper(admin, 'prev', {
      inviterId: 'alice', inviteeId: 'bob', status: 'requested', createdAgeS: AGES.pendingValidS, inviterSlot: 1,
    })
    await seedWhisperSlot(admin, 'alice', 1, {
      whisperId: 'prev', ageSeconds: AGES.pendingValidS, expiresAt: Timestamp.fromMillis(exp.toMillis() + 24 * 3600 * 1000),
    })
    await assertFails(invite(await userDb('alice'), { whisperId: 'w2', inviterSlot: 1 }).commit())
  })
})

describe('slot privacy and immutability', () => {
  async function seedHeld(): Promise<void> {
    const admin = await adminDb()
    await seedWhisper(admin, 'prev', {
      inviterId: 'alice', inviteeId: 'bob', status: 'ended', createdAgeS: 5 * 60, endedBy: 'alice', inviterSlot: 1,
    })
    await seedWhisperSlot(admin, 'alice', 1, { whisperId: 'prev', ageSeconds: 5 * 60 })
  }

  it('read of another person slot denied; own slot read allowed', async () => {
    await seedHeld()
    await assertFails(getDoc(doc(await userDb('bob'), 'whisperSlots', 'alice_1')))
    await assertFails(getDoc(doc(await unauthDb(), 'whisperSlots', 'alice_1')))
    await assertSucceeds(getDoc(doc(await userDb('alice'), 'whisperSlots', 'alice_1')))
  })

  it('list without the userId filter denied; with the filter allowed and only own slots returned', async () => {
    await seedHeld()
    const admin = await adminDb()
    await seedWhisperSlot(admin, 'bob', 1, { whisperId: 'prev', ageSeconds: 5 * 60 })
    const db = await userDb('alice')
    await assertFails(getDocs(collection(db, 'whisperSlots')))
    const snap = await assertSucceeds(getDocs(query(collection(db, 'whisperSlots'), where('userId', '==', 'alice'))))
    expect(snap.docs.map((d) => d.id)).toEqual(['alice_1'])
  })

  it('list by an unauthenticated client denied', async () => {
    await assertFails(getDocs(collection(await unauthDb(), 'whisperSlots')))
    await assertSucceeds(getDocs(query(collection(await userDb('alice'), 'whisperSlots'), where('userId', '==', 'alice'))))
  })

  it('delete of an own slot denied and the slot still exists; the same person can still reuse it', async () => {
    await seedHeld()
    const db = await userDb('alice')
    await assertFails(deleteDoc(doc(db, 'whisperSlots', 'alice_1')))
    expect(await docExists('whisperSlots', 'alice_1')).toBe(true)
    await assertSucceeds(invite(db, { whisperId: 'w2', inviterSlot: 1 }).commit())
  })

  it('delete of another person slot denied', async () => {
    await seedHeld()
    await assertFails(deleteDoc(doc(await userDb('bob'), 'whisperSlots', 'alice_1')))
    expect(await docExists('whisperSlots', 'alice_1')).toBe(true)
  })
})

describe('a second slot cannot be written for the same Whisper (added after a mutation check)', () => {
  // Found by mutation: removing the slot-side "slot id must be the one the Whisper names" clause
  // left every test green, because the Whisper side already forces the named slot to be written.
  // Nothing then stopped an extra slot pointing at the same Whisper from riding along.

  it('invite batch with an extra slot for the same Whisper denied; the named slot alone allowed', async () => {
    const db = await userDb('alice')
    const bad = invite(db, { inviterSlot: 1 })
    bad.set(doc(db, 'whisperSlots', 'alice_2'), {
      userId: 'alice',
      whisperId: 'w1',
      openedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 90 * MIN_MS),
    })
    await assertFails(bad.commit())
    expect(await docExists('whispers', 'w1')).toBe(false)
    expect(await docExists('whisperSlots', 'alice_2')).toBe(false)

    await assertSucceeds(invite(db, { inviterSlot: 1 }).commit())
  })

  it('accept batch with an extra slot for the same Whisper denied; the named slot alone allowed', async () => {
    const admin = await adminDb()
    const expiresAt = await seedWhisper(admin, 'w1', {
      inviterId: 'alice', inviteeId: 'bob', status: 'requested',
      createdAgeS: AGES.pendingValidS, inviterSlot: 1,
    })
    const db = await userDb('bob')
    const bad = await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1', inviteeSlot: 1, expiresAt })
    bad.set(doc(db, 'whisperSlots', 'bob_2'), {
      userId: 'bob', whisperId: 'w1', openedAt: serverTimestamp(), expiresAt,
    })
    await assertFails(bad.commit())
    expect(await docExists('whisperSlots', 'bob_1')).toBe(false)
    expect(await docExists('whisperSlots', 'bob_2')).toBe(false)

    await assertSucceeds((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1', inviteeSlot: 1, expiresAt })).commit())
  })
})
