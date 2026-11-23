import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { doc, getDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import {
  userDb,
  adminDb,
  clearData,
  teardown,
  assertFails,
  assertSucceeds,
} from './helpers.js'
import {
  AGES,
  acceptBatch,
  seedBlock,
  seedUser,
  seedWhisper,
  seedWhisperSlot,
  type WhisperStatus,
} from './whisperHelpers.js'

// alice invites bob. Backdated documents are planted with the admin context; ages stay away from
// the exact boundaries (14 versus 16 minutes for an invite, 30 versus 61 minutes for a thread).

beforeEach(async () => {
  await clearData()
  const admin = await adminDb()
  await seedUser(admin, 'alice')
  await seedUser(admin, 'bob')
  await seedUser(admin, 'carol')
})

afterAll(teardown)

async function seedPending(id = 'w1', createdAgeS: number = AGES.pendingValidS): Promise<void> {
  const admin = await adminDb()
  await seedWhisper(admin, id, {
    inviterId: 'alice', inviteeId: 'bob', status: 'requested', createdAgeS, inviterSlot: 1,
  })
}

async function seedThread(
  id: string,
  status: WhisperStatus,
  opts: { endedBy?: string; acceptedAgeS?: number } = {},
): Promise<void> {
  const admin = await adminDb()
  await seedWhisper(admin, id, {
    inviterId: 'alice',
    inviteeId: 'bob',
    status,
    createdAgeS: 70 * 60,
    acceptedAgeS: status === 'accepted' || status === 'ended' ? (opts.acceptedAgeS ?? AGES.open30S) : undefined,
    endedBy: opts.endedBy ?? null,
    inviterSlot: 1,
  })
}

async function statusOf(id: string): Promise<string | undefined> {
  const admin = await adminDb()
  return (await getDoc(doc(admin, 'whispers', id))).data()?.status
}

describe('accept', () => {
  it('accept by the invitee allowed (writes bob_1)', async () => {
    await seedPending()
    const db = await userDb('bob')
    await assertSucceeds((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1' })).commit())
    expect(await statusOf('w1')).toBe('accepted')
    const admin = await adminDb()
    expect((await getDoc(doc(admin, 'whisperSlots', 'bob_1'))).exists()).toBe(true)
    expect((await getDoc(doc(admin, 'whispers', 'w1'))).data()?.inviteeSlot).toBe(1)
  })

  it.each(['alice', 'carol'])('accept by %s denied; by the invitee allowed', async (who) => {
    await seedPending()
    // The slot is written for the caller, so only the caller's identity differs from the control.
    await assertFails((await acceptBatch(await userDb(who), { inviteeId: who, whisperId: 'w1' })).commit())
    expect(await statusOf('w1')).toBe('requested')
    await assertSucceeds((await acceptBatch(await userDb('bob'), { inviteeId: 'bob', whisperId: 'w1' })).commit())
  })

  it('accept of an invite 16 minutes old denied; 14 minutes old allowed', async () => {
    await seedPending('w_stale', AGES.pendingStaleS)
    await seedPending('w_ok', AGES.pendingValidS)
    const db = await userDb('bob')
    await assertFails((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w_stale' })).commit())
    expect(await statusOf('w_stale')).toBe('requested')
    await assertSucceeds((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w_ok' })).commit())
  })

  it('accept across age bands denied (bands now differ); same bands allowed', async () => {
    await seedPending()
    const admin = await adminDb()
    await seedUser(admin, 'bob', { band: '13_17' })
    const db = await userDb('bob')
    await assertFails((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1' })).commit())
    expect(await statusOf('w1')).toBe('requested')
    await seedUser(admin, 'bob', { band: '18_plus' })
    await assertSucceeds((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1' })).commit())
  })

  it('accept with under_13 on both sides denied', async () => {
    await seedPending()
    const admin = await adminDb()
    await seedUser(admin, 'alice', { band: 'under_13' })
    await seedUser(admin, 'bob', { band: 'under_13' })
    const db = await userDb('bob')
    await assertFails((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1' })).commit())
    await seedUser(admin, 'alice', { band: '13_17' })
    await seedUser(admin, 'bob', { band: '13_17' })
    await assertSucceeds((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1' })).commit())
  })

  it('accept denied when the invitee blocked the inviter, and when the inviter blocked the invitee', async () => {
    await seedPending()
    const admin = await adminDb()
    const db = await userDb('bob')

    await seedBlock(admin, 'bob', 'alice')
    await assertFails((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1' })).commit())
    await deleteDoc(doc(admin, 'users', 'bob', 'blocked', 'alice'))

    await seedBlock(admin, 'alice', 'bob')
    await assertFails((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1' })).commit())
    await deleteDoc(doc(admin, 'users', 'alice', 'blocked', 'bob'))

    await assertSucceeds((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1' })).commit())
  })

  it('acceptedAt that is not request.time denied; request.time allowed', async () => {
    await seedPending()
    const db = await userDb('bob')
    await assertFails(
      (await acceptBatch(db, {
        inviteeId: 'bob',
        whisperId: 'w1',
        whisperOverrides: { acceptedAt: Timestamp.fromMillis(Date.now() - 5000) },
      })).commit(),
    )
    await assertSucceeds((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1' })).commit())
  })

  it('accept where the written slot does not match inviteeSlot denied (uid_2 versus 1); matching slot allowed', async () => {
    await seedPending()
    const db = await userDb('bob')
    await assertFails(
      (await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1', inviteeSlot: 1, slotId: 'bob_2' })).commit(),
    )
    expect(await statusOf('w1')).toBe('requested')
    await assertSucceeds((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1', inviteeSlot: 1 })).commit())
  })

  it('accept with no slot write denied; with the slot allowed', async () => {
    await seedPending()
    const db = await userDb('bob')
    await assertFails((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1', omitSlot: true })).commit())
    await assertSucceeds((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1' })).commit())
  })

  it.each([0, 4])('accept with inviteeSlot %i denied; 2 allowed', async (n) => {
    await seedPending()
    const db = await userDb('bob')
    await assertFails((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1', inviteeSlot: n })).commit())
    await assertSucceeds((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1', inviteeSlot: 2 })).commit())
  })

  it('accept by an invitee holding three open whispers denied in every slot; with a free slot allowed', async () => {
    await seedPending()
    const admin = await adminDb()
    for (const n of [1, 2, 3] as const) {
      await seedWhisper(admin, `h${n}`, {
        inviterId: 'alice', inviteeId: 'bob', status: 'accepted',
        createdAgeS: 40 * 60, acceptedAgeS: AGES.open30S, inviterSlot: 1, inviteeSlot: n,
      })
      await seedWhisperSlot(admin, 'bob', n, { whisperId: `h${n}`, ageSeconds: AGES.open30S })
    }
    const db = await userDb('bob')
    for (const n of [1, 2, 3]) {
      await assertFails((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1', inviteeSlot: n })).commit())
    }
    expect(await statusOf('w1')).toBe('requested')

    await deleteDoc(doc(admin, 'whisperSlots', 'bob_3'))
    await assertSucceeds((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1', inviteeSlot: 3 })).commit())
  })

  it('accepting an already accepted whisper denied', async () => {
    await seedThread('w1', 'accepted')
    const db = await userDb('bob')
    await assertFails((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1' })).commit())
  })
})

describe('decline and cancel', () => {
  it('inviter cancels a pending invite allowed', async () => {
    await seedPending()
    await assertSucceeds(updateDoc(doc(await userDb('alice'), 'whispers', 'w1'), { status: 'ended', endedBy: 'alice' }))
    expect(await statusOf('w1')).toBe('ended')
  })

  it('invitee setting ended on a pending invite denied; inviter allowed', async () => {
    await seedPending()
    await assertFails(updateDoc(doc(await userDb('bob'), 'whispers', 'w1'), { status: 'ended', endedBy: 'bob' }))
    expect(await statusOf('w1')).toBe('requested')
    await assertSucceeds(updateDoc(doc(await userDb('alice'), 'whispers', 'w1'), { status: 'ended', endedBy: 'alice' }))
  })

  it('cancel that names someone else in endedBy denied; own uid allowed', async () => {
    await seedPending()
    const ref = doc(await userDb('alice'), 'whispers', 'w1')
    await assertFails(updateDoc(ref, { status: 'ended', endedBy: 'bob' }))
    await assertSucceeds(updateDoc(ref, { status: 'ended', endedBy: 'alice' }))
  })

  it('inviter setting declined denied; invitee allowed', async () => {
    await seedPending()
    await assertFails(updateDoc(doc(await userDb('alice'), 'whispers', 'w1'), { status: 'declined' }))
    await assertSucceeds(updateDoc(doc(await userDb('bob'), 'whispers', 'w1'), { status: 'declined' }))
    expect(await statusOf('w1')).toBe('declined')
  })

  it('invitee may decline a stale invite', async () => {
    await seedPending('w1', AGES.pendingStaleS)
    await assertSucceeds(updateDoc(doc(await userDb('bob'), 'whispers', 'w1'), { status: 'declined' }))
  })

  it('a third person cannot decline or cancel; the invitee can decline', async () => {
    await seedPending()
    const carol = await userDb('carol')
    await assertFails(updateDoc(doc(carol, 'whispers', 'w1'), { status: 'declined' }))
    await assertFails(updateDoc(doc(carol, 'whispers', 'w1'), { status: 'ended', endedBy: 'carol' }))
    await assertSucceeds(updateDoc(doc(await userDb('bob'), 'whispers', 'w1'), { status: 'declined' }))
  })

  it('decline that also sets endedBy denied; plain decline allowed', async () => {
    await seedPending()
    const ref = doc(await userDb('bob'), 'whispers', 'w1')
    await assertFails(updateDoc(ref, { status: 'declined', endedBy: 'bob' }))
    await assertSucceeds(updateDoc(ref, { status: 'declined' }))
  })
})

describe('end and closed threads', () => {
  it.each(['alice', 'bob'])('%s ends an accepted thread allowed', async (who) => {
    await seedThread('w1', 'accepted')
    await assertSucceeds(updateDoc(doc(await userDb(who), 'whispers', 'w1'), { status: 'ended', endedBy: who }))
    expect(await statusOf('w1')).toBe('ended')
  })

  it('a third person ending a thread denied; a member allowed', async () => {
    await seedThread('w1', 'accepted')
    await assertFails(updateDoc(doc(await userDb('carol'), 'whispers', 'w1'), { status: 'ended', endedBy: 'carol' }))
    await assertSucceeds(updateDoc(doc(await userDb('alice'), 'whispers', 'w1'), { status: 'ended', endedBy: 'alice' }))
  })

  it('ending after the hour is still allowed (tidies the record)', async () => {
    await seedThread('w1', 'accepted', { acceptedAgeS: AGES.overS })
    await assertSucceeds(updateDoc(doc(await userDb('bob'), 'whispers', 'w1'), { status: 'ended', endedBy: 'bob' }))
  })

  it('end that names someone else in endedBy denied; own uid allowed', async () => {
    await seedThread('w1', 'accepted')
    const ref = doc(await userDb('alice'), 'whispers', 'w1')
    await assertFails(updateDoc(ref, { status: 'ended', endedBy: 'bob' }))
    await assertSucceeds(updateDoc(ref, { status: 'ended', endedBy: 'alice' }))
  })

  it('every transition out of declined and out of ended denied', async () => {
    await seedThread('w_dec', 'declined')
    await seedThread('w_end', 'ended', { endedBy: 'alice' })
    for (const id of ['w_dec', 'w_end']) {
      for (const who of ['alice', 'bob']) {
        const ref = doc(await userDb(who), 'whispers', id)
        await assertFails(updateDoc(ref, { status: 'requested' }))
        await assertFails(updateDoc(ref, { status: 'accepted', acceptedAt: serverTimestamp(), inviteeSlot: 1 }))
        await assertFails(updateDoc(ref, { status: 'declined' }))
        await assertFails(updateDoc(ref, { status: 'ended', endedBy: who }))
      }
    }
    // Control: an accepted thread can be ended by either member.
    await seedThread('w_acc', 'accepted')
    await assertSucceeds(updateDoc(doc(await userDb('alice'), 'whispers', 'w_acc'), { status: 'ended', endedBy: 'alice' }))
  })

  it('accepted to requested and accepted to declined denied; accepted to ended allowed', async () => {
    await seedThread('w1', 'accepted')
    const ref = doc(await userDb('bob'), 'whispers', 'w1')
    await assertFails(updateDoc(ref, { status: 'requested' }))
    await assertFails(updateDoc(ref, { status: 'declined' }))
    expect(await statusOf('w1')).toBe('accepted')
    await assertSucceeds(updateDoc(ref, { status: 'ended', endedBy: 'bob' }))
  })
})

describe('immutability', () => {
  const changes: [string, unknown][] = [
    ['inviterId', 'bob'],
    ['inviteeId', 'carol'],
    ['memberIds', ['alice', 'carol']],
    ['createdAt', Timestamp.now()],
    ['inviterSlot', 2],
    ['expiresAt', Timestamp.fromMillis(Date.now() + 3 * 3600 * 1000)],
    ['inviteeSlot', 1],
  ]

  it.each(changes)('changing %s together with a valid cancel denied; plain cancel allowed', async (field, value) => {
    await seedPending()
    const ref = doc(await userDb('alice'), 'whispers', 'w1')
    await assertFails(updateDoc(ref, { status: 'ended', endedBy: 'alice', [field]: value }))
    expect(await statusOf('w1')).toBe('requested')
    await assertSucceeds(updateDoc(ref, { status: 'ended', endedBy: 'alice' }))
  })

  it('an update that changes no status but another field denied', async () => {
    await seedThread('w1', 'accepted')
    const ref = doc(await userDb('alice'), 'whispers', 'w1')
    await assertFails(updateDoc(ref, { inviterSlot: 3 }))
    await assertSucceeds(updateDoc(ref, { status: 'ended', endedBy: 'alice' }))
  })

  it('accept that also sets endedBy denied; plain accept allowed', async () => {
    await seedPending()
    const db = await userDb('bob')
    await assertFails(
      (await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1', whisperOverrides: { endedBy: 'bob' } })).commit(),
    )
    await assertSucceeds((await acceptBatch(db, { inviteeId: 'bob', whisperId: 'w1' })).commit())
  })

  it('inviteeSlot changed after accept denied; plain end allowed', async () => {
    await seedThread('w1', 'accepted')
    const ref = doc(await userDb('alice'), 'whispers', 'w1')
    await assertFails(updateDoc(ref, { status: 'ended', endedBy: 'alice', inviteeSlot: 2 }))
    await assertSucceeds(updateDoc(ref, { status: 'ended', endedBy: 'alice' }))
  })

  it('delete of a Whisper denied; the member can still use it', async () => {
    await seedThread('w1', 'accepted')
    const ref = doc(await userDb('alice'), 'whispers', 'w1')
    await assertFails(deleteDoc(ref))
    const admin = await adminDb()
    expect((await getDoc(doc(admin, 'whispers', 'w1'))).exists()).toBe(true)
    await assertSucceeds(updateDoc(ref, { status: 'ended', endedBy: 'alice' }))
  })
})
