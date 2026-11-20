import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  writeBatch,
  collection,
  query,
  where,
} from 'firebase/firestore'
import {
  userADb,
  userBDb,
  unauthDb,
  adminDb,
  clearData,
  teardown,
  assertFails,
  assertSucceeds,
} from './helpers.js'
import { createRoomBatch, seedSlot, seedUser } from './roomLimitHelpers.js'

// Slot ages. The exact 24-hour boundary is avoided because request.time cannot be faked.
const HOUR_S = 60 * 60
const ACTIVE_AGE_S = 1 * HOUR_S
const EXPIRED_AGE_S = 24 * HOUR_S + 60

beforeEach(async () => {
  await clearData()
  const admin = await adminDb()
  await seedUser(admin, 'userA')
  await seedUser(admin, 'userB')
})

afterAll(teardown)

describe('two-active-room limit', () => {
  it('first room with userA_1 succeeds', async () => {
    const db = await userADb()
    await assertSucceeds(
      createRoomBatch(db, { uid: 'userA', roomId: 'roomA1', slotId: 'userA_1' }).commit(),
    )
    const admin = await adminDb()
    expect((await getDoc(doc(admin, 'rooms', 'roomA1'))).exists()).toBe(true)
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).data()?.roomId).toBe('roomA1')
  })

  it('second room with userA_2 succeeds while userA_1 is active', async () => {
    const admin = await adminDb()
    await seedSlot(admin, 'userA', 1, { ageSeconds: ACTIVE_AGE_S })
    const db = await userADb()
    await assertSucceeds(
      createRoomBatch(db, { uid: 'userA', roomId: 'roomA2', slotId: 'userA_2' }).commit(),
    )
    expect((await getDoc(doc(admin, 'rooms', 'roomA2'))).exists()).toBe(true)
  })

  it('third room is denied while both slots are active, and nothing is written', async () => {
    const admin = await adminDb()
    await seedSlot(admin, 'userA', 1, { roomId: 'seed1', ageSeconds: ACTIVE_AGE_S })
    await seedSlot(admin, 'userA', 2, { roomId: 'seed2', ageSeconds: ACTIVE_AGE_S })
    const db = await userADb()

    await assertFails(
      createRoomBatch(db, { uid: 'userA', roomId: 'roomA3', slotId: 'userA_1' }).commit(),
    )
    await assertFails(
      createRoomBatch(db, { uid: 'userA', roomId: 'roomA3', slotId: 'userA_2' }).commit(),
    )

    expect((await getDoc(doc(admin, 'rooms', 'roomA3'))).exists()).toBe(false)
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).data()?.roomId).toBe('seed1')
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_2'))).data()?.roomId).toBe('seed2')
  })

  it('positive control: same third batch succeeds once userA_1 is older than 24 hours', async () => {
    const admin = await adminDb()
    await seedSlot(admin, 'userA', 1, { roomId: 'seed1', ageSeconds: EXPIRED_AGE_S })
    await seedSlot(admin, 'userA', 2, { roomId: 'seed2', ageSeconds: ACTIVE_AGE_S })
    const db = await userADb()

    await assertSucceeds(
      createRoomBatch(db, { uid: 'userA', roomId: 'roomA3', slotId: 'userA_1' }).commit(),
    )

    expect((await getDoc(doc(admin, 'rooms', 'roomA3'))).exists()).toBe(true)
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).data()?.roomId).toBe('roomA3')
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_2'))).data()?.roomId).toBe('seed2')
  })

  it('a slot with a recent openedAt and a past expiresAt still blocks a third room', async () => {
    const admin = await adminDb()
    const now = Date.now()
    // Active by openedAt (1 hour ago); expiresAt is in the past and must be ignored.
    await setDoc(doc(admin, 'roomSlots', 'userA_1'), {
      userId: 'userA',
      roomId: 'seed1',
      openedAt: Timestamp.fromMillis(now - ACTIVE_AGE_S * 1000),
      expiresAt: Timestamp.fromMillis(now - 60 * 1000),
    })
    await seedSlot(admin, 'userA', 2, { roomId: 'seed2', ageSeconds: ACTIVE_AGE_S })
    const db = await userADb()

    await assertFails(
      createRoomBatch(db, { uid: 'userA', roomId: 'roomA3', slotId: 'userA_1' }).commit(),
    )
    expect((await getDoc(doc(admin, 'rooms', 'roomA3'))).exists()).toBe(false)
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).data()?.roomId).toBe('seed1')

    // Positive control: same shape, but openedAt is old (expiresAt still in the past) -> reusable.
    await setDoc(doc(admin, 'roomSlots', 'userA_1'), {
      userId: 'userA',
      roomId: 'seed1',
      openedAt: Timestamp.fromMillis(now - EXPIRED_AGE_S * 1000),
      expiresAt: Timestamp.fromMillis(now - 60 * 1000),
    })
    await assertSucceeds(
      createRoomBatch(db, { uid: 'userA', roomId: 'roomA3', slotId: 'userA_1' }).commit(),
    )
  })
})

describe('slot shape and id (Property 1)', () => {
  // Each case: a single bad condition, then the same batch with that condition fixed.
  async function expectDeniedThenFixed(
    bad: Parameters<typeof createRoomBatch>[1],
    fixed: Parameters<typeof createRoomBatch>[1],
  ) {
    const db = await userADb()
    const admin = await adminDb()
    await assertFails(createRoomBatch(db, bad).commit())
    expect((await getDoc(doc(admin, 'rooms', bad.roomId))).exists()).toBe(false)
    expect((await getDoc(doc(admin, 'roomSlots', bad.slotId))).exists()).toBe(false)
    await assertSucceeds(createRoomBatch(db, fixed).commit())
    expect((await getDoc(doc(admin, 'rooms', fixed.roomId))).exists()).toBe(true)
    expect((await getDoc(doc(admin, 'roomSlots', fixed.slotId))).exists()).toBe(true)
  }

  const base = { uid: 'userA', roomId: 'roomS1', slotId: 'userA_1' }
  const HOUR_MS = 60 * 60 * 1000

  it('denies a slot id of another user (userB_1); userA_1 succeeds', async () => {
    await expectDeniedThenFixed({ ...base, slotId: 'userB_1' }, base)
  })

  it('denies a slot id outside _1/_2 (userA_3); userA_2 succeeds', async () => {
    await expectDeniedThenFixed({ ...base, slotId: 'userA_3' }, { ...base, slotId: 'userA_2' })
  })

  it('denies an extra slot field; exactly four fields succeed', async () => {
    await expectDeniedThenFixed({ ...base, slotOverrides: { extra: 'x' } }, base)
  })

  it('denies a missing slot field; all four fields succeed', async () => {
    await expectDeniedThenFixed({ ...base, slotOverrides: { userId: undefined } }, base)
  })

  it('denies a renamed slot field; the correct name succeeds', async () => {
    await expectDeniedThenFixed(
      { ...base, slotOverrides: { expiresAt: undefined, expires: Timestamp.fromMillis(Date.now() + 25 * HOUR_MS) } },
      base,
    )
  })

  it('denies a slot userId that is not the caller; own userId succeeds', async () => {
    await expectDeniedThenFixed({ ...base, slotOverrides: { userId: 'userB' } }, base)
  })

  it('denies a backdated slot openedAt; serverTimestamp succeeds', async () => {
    await expectDeniedThenFixed(
      { ...base, slotOverrides: { openedAt: Timestamp.fromMillis(Date.now() - HOUR_MS) } },
      base,
    )
  })

  it('denies a future slot openedAt; serverTimestamp succeeds', async () => {
    await expectDeniedThenFixed(
      { ...base, slotOverrides: { openedAt: Timestamp.fromMillis(Date.now() + HOUR_MS) } },
      base,
    )
  })

  it('denies a slot expiresAt that differs from the room expiresAt; equal succeeds', async () => {
    await expectDeniedThenFixed(
      { ...base, slotOverrides: { expiresAt: Timestamp.fromMillis(Date.now() + 25 * HOUR_MS + 60_000) } },
      base,
    )
  })

  it('denies an empty slot roomId; a valid roomId succeeds', async () => {
    await expectDeniedThenFixed({ ...base, slotOverrides: { roomId: '' } }, base)
  })

  it('denies a non-string slot roomId; a valid roomId succeeds', async () => {
    await expectDeniedThenFixed({ ...base, slotOverrides: { roomId: 123 } }, base)
  })

  it('denies an unauthenticated slot write; userA succeeds', async () => {
    const unauth = await unauthDb()
    const admin = await adminDb()
    await assertFails(createRoomBatch(unauth, { ...base, omitRoom: true }).commit())
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).exists()).toBe(false)

    const db = await userADb()
    await assertSucceeds(createRoomBatch(db, base).commit())
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).exists()).toBe(true)
  })
})


describe('room and slot linkage (Properties 2 and 3)', () => {
  const HOUR_MS = 60 * 60 * 1000
  const base = { uid: 'userA', roomId: 'roomL1', slotId: 'userA_1' }

  function roomData(uid: string, expiresAt: Timestamp, extra: Record<string, unknown> = {}) {
    return {
      type: 'open_topic',
      title: 'Test room',
      maturityLabel: 'all_ages',
      categories: ['other'],
      openedAt: serverTimestamp(),
      expiresAt,
      createdBy: uid,
      postingParticipantCount: 0,
      ...extra,
    }
  }

  function slotData(uid: string, roomId: string, expiresAt: Timestamp) {
    return { userId: uid, roomId, openedAt: serverTimestamp(), expiresAt }
  }

  it('denies a room create without a slot; the same room with its slot succeeds', async () => {
    const db = await userADb()
    const admin = await adminDb()
    await assertFails(createRoomBatch(db, { ...base, omitSlot: true }).commit())
    expect((await getDoc(doc(admin, 'rooms', 'roomL1'))).exists()).toBe(false)

    await assertSucceeds(createRoomBatch(db, base).commit())
    expect((await getDoc(doc(admin, 'rooms', 'roomL1'))).exists()).toBe(true)
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).exists()).toBe(true)
  })

  it("denies a slot pointing at userB's existing room; pointing at the new room succeeds", async () => {
    const admin = await adminDb()
    await setDoc(doc(admin, 'rooms', 'roomB1'), {
      type: 'open_topic',
      title: 'B room',
      maturityLabel: 'all_ages',
      categories: ['other'],
      openedAt: Timestamp.fromMillis(Date.now() - HOUR_MS),
      expiresAt: Timestamp.fromMillis(Date.now() + 23 * HOUR_MS),
      createdBy: 'userB',
      postingParticipantCount: 0,
    })
    const db = await userADb()

    await assertFails(
      createRoomBatch(db, {
        ...base,
        omitRoom: true,
        slotOverrides: { roomId: 'roomB1' },
      }).commit(),
    )
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).exists()).toBe(false)
    expect((await getDoc(doc(admin, 'rooms', 'roomB1'))).data()?.createdBy).toBe('userB')

    await assertSucceeds(createRoomBatch(db, base).commit())
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).data()?.roomId).toBe('roomL1')
  })

  it('denies two room creates with one slot and writes nothing; two rooms with two slots succeed', async () => {
    const db = await userADb()
    const admin = await adminDb()
    const expiresAt = Timestamp.fromMillis(Date.now() + 25 * HOUR_MS)

    const bad = writeBatch(db)
    bad.set(doc(db, 'rooms', 'roomL1'), roomData('userA', expiresAt))
    bad.set(doc(db, 'rooms', 'roomL2'), roomData('userA', expiresAt))
    bad.set(doc(db, 'roomSlots', 'userA_1'), slotData('userA', 'roomL1', expiresAt))
    await assertFails(bad.commit())
    expect((await getDoc(doc(admin, 'rooms', 'roomL1'))).exists()).toBe(false)
    expect((await getDoc(doc(admin, 'rooms', 'roomL2'))).exists()).toBe(false)
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).exists()).toBe(false)

    const good = writeBatch(db)
    good.set(doc(db, 'rooms', 'roomL1'), roomData('userA', expiresAt))
    good.set(doc(db, 'rooms', 'roomL2'), roomData('userA', expiresAt))
    good.set(doc(db, 'roomSlots', 'userA_1'), slotData('userA', 'roomL1', expiresAt))
    good.set(doc(db, 'roomSlots', 'userA_2'), slotData('userA', 'roomL2', expiresAt))
    await assertSucceeds(good.commit())
    expect((await getDoc(doc(admin, 'rooms', 'roomL1'))).exists()).toBe(true)
    expect((await getDoc(doc(admin, 'rooms', 'roomL2'))).exists()).toBe(true)
  })

  it('still denies a room that breaks an existing room rule even with a valid slot', async () => {
    const db = await userADb()
    const admin = await adminDb()
    const tooLate = Timestamp.fromMillis(Date.now() + 30 * HOUR_MS)

    // expiresAt of now + 30h on both room and slot (slot matches the room, so only the room rule fails)
    await assertFails(
      createRoomBatch(db, {
        ...base,
        roomOverrides: { expiresAt: tooLate },
        slotOverrides: { expiresAt: tooLate },
      }).commit(),
    )
    expect((await getDoc(doc(admin, 'rooms', 'roomL1'))).exists()).toBe(false)
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).exists()).toBe(false)

    await assertFails(
      createRoomBatch(db, { ...base, roomOverrides: { maturityLabel: 'not_a_label' } }).commit(),
    )
    expect((await getDoc(doc(admin, 'rooms', 'roomL1'))).exists()).toBe(false)

    await assertSucceeds(createRoomBatch(db, base).commit())
    expect((await getDoc(doc(admin, 'rooms', 'roomL1'))).exists()).toBe(true)
  })
})


describe('slot immutability and reuse (Properties 5 and 6)', () => {
  const OLD_ROOM = 'oldRoom'
  const HOUR_MS = 60 * 60 * 1000

  async function slotSnapshot(id: string) {
    const admin = await adminDb()
    const s = await getDoc(doc(admin, 'roomSlots', id))
    return s.exists() ? s.data() : null
  }

  async function seedExpired() {
    const admin = await adminDb()
    await seedSlot(admin, 'userA', 1, { roomId: OLD_ROOM, ageSeconds: EXPIRED_AGE_S })
    return slotSnapshot('userA_1')
  }

  async function seedActive() {
    const admin = await adminDb()
    await seedSlot(admin, 'userA', 1, { roomId: OLD_ROOM, ageSeconds: ACTIVE_AGE_S })
    return slotSnapshot('userA_1')
  }

  it('denies delete of an active own slot; the slot is readable and unchanged', async () => {
    const before = await seedActive()
    const db = await userADb()
    await assertSucceeds(getDoc(doc(db, 'roomSlots', 'userA_1')))
    await assertFails(deleteDoc(doc(db, 'roomSlots', 'userA_1')))
    expect(await slotSnapshot('userA_1')).toEqual(before)
  })

  it('denies delete of an expired own slot; the slot is readable and unchanged', async () => {
    const before = await seedExpired()
    const db = await userADb()
    await assertSucceeds(getDoc(doc(db, 'roomSlots', 'userA_1')))
    await assertFails(deleteDoc(doc(db, 'roomSlots', 'userA_1')))
    expect(await slotSnapshot('userA_1')).toEqual(before)
  })

  it('denies a direct update of an unexpired slot; slot unchanged', async () => {
    const before = await seedActive()
    const db = await userADb()
    await assertFails(updateDoc(doc(db, 'roomSlots', 'userA_1'), { roomId: 'newRoom' }))
    expect(await slotSnapshot('userA_1')).toEqual(before)
  })

  it('denies an unexpired-slot update inside a room-create batch; expired slot succeeds', async () => {
    const before = await seedActive()
    const db = await userADb()
    await assertFails(
      createRoomBatch(db, { uid: 'userA', roomId: 'newRoom', slotId: 'userA_1' }).commit(),
    )
    expect(await slotSnapshot('userA_1')).toEqual(before)
    const admin = await adminDb()
    expect((await getDoc(doc(admin, 'rooms', 'newRoom'))).exists()).toBe(false)

    // Positive control: same batch against an expired slot.
    await seedExpired()
    await assertSucceeds(
      createRoomBatch(db, { uid: 'userA', roomId: 'newRoom', slotId: 'userA_1' }).commit(),
    )
    expect((await slotSnapshot('userA_1'))?.roomId).toBe('newRoom')
  })

  it('denies an expired-slot update outside a room-create batch; inside the batch succeeds', async () => {
    const before = await seedExpired()
    const db = await userADb()
    await assertFails(
      createRoomBatch(db, { uid: 'userA', roomId: 'newRoom', slotId: 'userA_1', omitRoom: true }).commit(),
    )
    expect(await slotSnapshot('userA_1')).toEqual(before)

    await assertFails(updateDoc(doc(db, 'roomSlots', 'userA_1'), { roomId: 'newRoom' }))
    expect(await slotSnapshot('userA_1')).toEqual(before)

    await assertSucceeds(
      createRoomBatch(db, { uid: 'userA', roomId: 'newRoom', slotId: 'userA_1' }).commit(),
    )
    expect((await slotSnapshot('userA_1'))?.roomId).toBe('newRoom')
  })

  it('denies reuse with the old roomId; a new roomId succeeds', async () => {
    const before = await seedExpired()
    const db = await userADb()
    await assertFails(
      createRoomBatch(db, { uid: 'userA', roomId: OLD_ROOM, slotId: 'userA_1' }).commit(),
    )
    expect(await slotSnapshot('userA_1')).toEqual(before)

    await assertSucceeds(
      createRoomBatch(db, { uid: 'userA', roomId: 'newRoom', slotId: 'userA_1' }).commit(),
    )
    expect((await slotSnapshot('userA_1'))?.roomId).toBe('newRoom')
  })

  it('denies reuse with a past openedAt; serverTimestamp succeeds', async () => {
    const before = await seedExpired()
    const db = await userADb()
    await assertFails(
      createRoomBatch(db, {
        uid: 'userA', roomId: 'newRoom', slotId: 'userA_1',
        slotOverrides: { openedAt: Timestamp.fromMillis(Date.now() - HOUR_MS) },
      }).commit(),
    )
    expect(await slotSnapshot('userA_1')).toEqual(before)

    await assertSucceeds(
      createRoomBatch(db, { uid: 'userA', roomId: 'newRoom', slotId: 'userA_1' }).commit(),
    )
    expect((await slotSnapshot('userA_1'))?.roomId).toBe('newRoom')
  })

  it('denies reuse with a future openedAt; serverTimestamp succeeds', async () => {
    const before = await seedExpired()
    const db = await userADb()
    await assertFails(
      createRoomBatch(db, {
        uid: 'userA', roomId: 'newRoom', slotId: 'userA_1',
        slotOverrides: { openedAt: Timestamp.fromMillis(Date.now() + HOUR_MS) },
      }).commit(),
    )
    expect(await slotSnapshot('userA_1')).toEqual(before)

    await assertSucceeds(
      createRoomBatch(db, { uid: 'userA', roomId: 'newRoom', slotId: 'userA_1' }).commit(),
    )
    expect((await slotSnapshot('userA_1'))?.roomId).toBe('newRoom')
  })
})


describe('slot privacy (Property 7)', () => {
  async function seedBoth() {
    const admin = await adminDb()
    await seedSlot(admin, 'userA', 1, { roomId: 'seedA1', ageSeconds: ACTIVE_AGE_S })
    await seedSlot(admin, 'userB', 1, { roomId: 'seedB1', ageSeconds: ACTIVE_AGE_S })
  }

  it('owner can get own slot; other user and unauthenticated cannot', async () => {
    await seedBoth()
    const a = await userADb()
    const snap = await assertSucceeds(getDoc(doc(a, 'roomSlots', 'userA_1')))
    expect(snap.data()?.roomId).toBe('seedA1')

    const b = await userBDb()
    await assertFails(getDoc(doc(b, 'roomSlots', 'userA_1')))
    const unauth = await unauthDb()
    await assertFails(getDoc(doc(unauth, 'roomSlots', 'userA_1')))
  })

  it("denies userB writing under userA's slot id; slot unchanged", async () => {
    await seedBoth()
    const admin = await adminDb()
    const before = (await getDoc(doc(admin, 'roomSlots', 'userA_1'))).data()
    const b = await userBDb()

    await assertFails(
      setDoc(doc(b, 'roomSlots', 'userA_1'), {
        userId: 'userB',
        roomId: 'hijack',
        openedAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 25 * HOUR_S * 1000),
      }),
    )
    await assertFails(updateDoc(doc(b, 'roomSlots', 'userA_1'), { roomId: 'hijack' }))
    await assertFails(setDoc(doc(b, 'roomSlots', 'userA_2'), { userId: 'userB', roomId: 'x' }))

    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).data()).toEqual(before)
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_2'))).exists()).toBe(false)
  })

  it('denies an unfiltered list for userA; a userId-filtered list returns only userA slots', async () => {
    await seedBoth()
    const a = await userADb()

    await assertFails(getDocs(collection(a, 'roomSlots')))

    const result = await assertSucceeds(
      getDocs(query(collection(a, 'roomSlots'), where('userId', '==', 'userA'))),
    )
    const ids = result.docs.map((d) => d.id)
    expect(ids).toEqual(['userA_1'])
    expect(ids).not.toContain('userB_1')
  })

  it("denies userB listing userA's slots, and an unauthenticated list", async () => {
    await seedBoth()
    const b = await userBDb()
    await assertFails(getDocs(query(collection(b, 'roomSlots'), where('userId', '==', 'userA'))))

    const unauth = await unauthDb()
    await assertFails(getDocs(query(collection(unauth, 'roomSlots'), where('userId', '==', 'userA'))))
    await assertFails(getDocs(collection(unauth, 'roomSlots')))
  })

  it('a get on the caller\'s own missing slot id returns a non-existent snapshot, not a permission error', async () => {
    await seedBoth()
    const a = await userADb()
    const snap = await assertSucceeds(getDoc(doc(a, 'roomSlots', 'userA_2')))
    expect(snap.exists()).toBe(false)

    // Control: another user's missing slot id is still denied.
    await assertFails(getDoc(doc(a, 'roomSlots', 'userB_2')))
  })
})


describe('expiry is derived only from openedAt (Property 8)', () => {
  const batchOpts = { uid: 'userA', roomId: 'roomX1', slotId: 'userA_1' }

  // The other slot is always active so the target slot (userA_1) is the only variable.
  async function seedOtherActive() {
    const admin = await adminDb()
    await seedSlot(admin, 'userA', 2, { roomId: 'seed2', ageSeconds: ACTIVE_AGE_S })
    return admin
  }

  it('a slot 23 hours old is active (create denied); 24 hours plus 1 minute is expired (create succeeds)', async () => {
    const admin = await seedOtherActive()
    const db = await userADb()

    await seedSlot(admin, 'userA', 1, { roomId: 'seed1', ageSeconds: 23 * HOUR_S })
    await assertFails(createRoomBatch(db, batchOpts).commit())
    expect((await getDoc(doc(admin, 'rooms', 'roomX1'))).exists()).toBe(false)
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).data()?.roomId).toBe('seed1')

    await seedSlot(admin, 'userA', 1, { roomId: 'seed1', ageSeconds: 24 * HOUR_S + 60 })
    await assertSucceeds(createRoomBatch(db, batchOpts).commit())
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).data()?.roomId).toBe('roomX1')
  })

  it('recent openedAt with a past expiresAt is still active (create denied)', async () => {
    const admin = await seedOtherActive()
    const db = await userADb()
    const now = Date.now()
    await setDoc(doc(admin, 'roomSlots', 'userA_1'), {
      userId: 'userA',
      roomId: 'seed1',
      openedAt: Timestamp.fromMillis(now - ACTIVE_AGE_S * 1000),
      expiresAt: Timestamp.fromMillis(now - 60 * 60 * 1000),
    })
    await assertFails(createRoomBatch(db, batchOpts).commit())
    expect((await getDoc(doc(admin, 'rooms', 'roomX1'))).exists()).toBe(false)
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).data()?.roomId).toBe('seed1')
  })

  it('old openedAt with a future expiresAt is expired (create succeeds)', async () => {
    const admin = await seedOtherActive()
    const db = await userADb()
    const now = Date.now()
    await setDoc(doc(admin, 'roomSlots', 'userA_1'), {
      userId: 'userA',
      roomId: 'seed1',
      openedAt: Timestamp.fromMillis(now - EXPIRED_AGE_S * 1000),
      expiresAt: Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
    })
    await assertSucceeds(createRoomBatch(db, batchOpts).commit())
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).data()?.roomId).toBe('roomX1')
  })

  it('a stored slot with a missing openedAt denies the dependent write; a valid expired slot succeeds', async () => {
    const admin = await seedOtherActive()
    const db = await userADb()
    await setDoc(doc(admin, 'roomSlots', 'userA_1'), {
      userId: 'userA',
      roomId: 'seed1',
      expiresAt: Timestamp.fromMillis(Date.now() - 60 * 1000),
    })
    await assertFails(createRoomBatch(db, batchOpts).commit())
    expect((await getDoc(doc(admin, 'rooms', 'roomX1'))).exists()).toBe(false)
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).data()?.roomId).toBe('seed1')

    await seedSlot(admin, 'userA', 1, { roomId: 'seed1', ageSeconds: EXPIRED_AGE_S })
    await assertSucceeds(createRoomBatch(db, batchOpts).commit())
  })

  it('a stored slot with a non-timestamp openedAt denies the dependent write; a valid expired slot succeeds', async () => {
    const admin = await seedOtherActive()
    const db = await userADb()
    await setDoc(doc(admin, 'roomSlots', 'userA_1'), {
      userId: 'userA',
      roomId: 'seed1',
      openedAt: '2020-01-01T00:00:00Z',
      expiresAt: Timestamp.fromMillis(Date.now() - 60 * 1000),
    })
    await assertFails(createRoomBatch(db, batchOpts).commit())
    expect((await getDoc(doc(admin, 'rooms', 'roomX1'))).exists()).toBe(false)
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).data()?.roomId).toBe('seed1')

    await seedSlot(admin, 'userA', 1, { roomId: 'seed1', ageSeconds: EXPIRED_AGE_S })
    await assertSucceeds(createRoomBatch(db, batchOpts).commit())
  })
})


describe('rules access-call budget: worst-case valid batch', () => {
  // Documentation finding (Firebase "Security rule limits", checked while writing this test):
  // - Maximum exists()/get()/getAfter() calls per request: 10 for single-document requests
  //   and query requests; 20 for multi-document reads, transactions and batched writes.
  // - In a batched write the limit of 10 also applies to each operation. Example from the docs:
  //   3 writes at 2 access calls each use 2 of 10 per write and 6 of 20 for the batch.
  // - Exceeding either limit gives permission denied.
  // - The docs say only that "some document access calls may be cached, and cached calls do
  //   not count towards the limits". They do not state that repeated accesses to the same
  //   document always count once, so this suite does not rely on that. The test below
  //   exercises the worst valid path against the emulator instead.

  it('room targeting userA_2 succeeds while userA_1 is active (_1 check fails, _2 evaluated, user doc read)', async () => {
    const admin = await adminDb()
    await seedSlot(admin, 'userA', 1, { roomId: 'seed1', ageSeconds: ACTIVE_AGE_S })
    const db = await userADb()

    await assertSucceeds(
      createRoomBatch(db, { uid: 'userA', roomId: 'roomW1', slotId: 'userA_2' }).commit(),
    )
    expect((await getDoc(doc(admin, 'rooms', 'roomW1'))).exists()).toBe(true)
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_2'))).data()?.roomId).toBe('roomW1')
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).data()?.roomId).toBe('seed1')
  })

  it('room reusing an expired userA_2 succeeds while userA_1 is active (update batch)', async () => {
    const admin = await adminDb()
    await seedSlot(admin, 'userA', 1, { roomId: 'seed1', ageSeconds: ACTIVE_AGE_S })
    await seedSlot(admin, 'userA', 2, { roomId: 'seed2', ageSeconds: 24 * HOUR_S + 60 })
    const db = await userADb()

    await assertSucceeds(
      createRoomBatch(db, { uid: 'userA', roomId: 'roomW2', slotId: 'userA_2' }).commit(),
    )
    expect((await getDoc(doc(admin, 'rooms', 'roomW2'))).exists()).toBe(true)
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_2'))).data()?.roomId).toBe('roomW2')
    expect((await getDoc(doc(admin, 'roomSlots', 'userA_1'))).data()?.roomId).toBe('seed1')
  })
})
