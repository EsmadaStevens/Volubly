import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { doc, getDoc } from 'firebase/firestore'
import {
  userDb,
  adminDb,
  clearData,
  teardown,
  assertSucceeds,
} from './helpers.js'
import {
  AGES,
  acceptBatch,
  inviteBatch,
  messageBatch,
  seedRateLimit,
  seedUser,
  seedWhisper,
  seedWhisperSlot,
} from './whisperHelpers.js'

/*
 * Rules-lookup budget. Firestore allows 10 document access calls per single-document operation
 * and 20 per batch. Finding from the Firestore security rules documentation: exceeding either
 * limit gives permission-denied, and some access calls may be cached, and cached calls do not
 * count towards the limits. The design therefore counts every call (get, getAfter, exists,
 * existsAfter) on every path as one and takes no credit for caching.
 *
 * Counted worst cases (see design.md, "Lookup budget"):
 *   invite batch with slot reuse   whisper create 6 + slot update 4 = 10 of 20
 *   accept batch with slot reuse   whisper update 6 + slot update 4 = 10 of 20
 *   first message                  message 6 + rate limit create 1   = 7 of 20
 *   later message                  message 6 + rate limit update 1   = 7 of 20
 * These tests are the evidence: if any of them fails with permission-denied while its twin in the
 * other test files passes, a lookup limit is the first thing to suspect.
 */

beforeEach(async () => {
  await clearData()
  const admin = await adminDb()
  await seedUser(admin, 'alice')
  await seedUser(admin, 'bob')
})

afterAll(teardown)

describe('worst-case lookup budget', () => {
  it('invite batch that reuses a slot (previous thread ended) succeeds', async () => {
    const admin = await adminDb()
    await seedWhisper(admin, 'old', {
      inviterId: 'alice', inviteeId: 'bob', status: 'ended', createdAgeS: 3 * 3600, endedBy: 'alice', inviterSlot: 1,
    })
    await seedWhisperSlot(admin, 'alice', 1, { whisperId: 'old', ageSeconds: 3 * 3600 })

    await assertSucceeds(
      inviteBatch(await userDb('alice'), { inviterId: 'alice', inviteeId: 'bob', whisperId: 'w1', inviterSlot: 1 }).commit(),
    )
    expect((await getDoc(doc(admin, 'whisperSlots', 'alice_1'))).data()?.whisperId).toBe('w1')
  })

  it('accept batch that reuses a slot (previous thread ended) succeeds', async () => {
    const admin = await adminDb()
    await seedWhisper(admin, 'w1', {
      inviterId: 'alice', inviteeId: 'bob', status: 'requested', createdAgeS: AGES.pendingValidS, inviterSlot: 1,
    })
    await seedWhisper(admin, 'old', {
      inviterId: 'carol', inviteeId: 'bob', status: 'ended', createdAgeS: 3 * 3600, endedBy: 'bob', inviterSlot: 1,
    })
    await seedWhisperSlot(admin, 'bob', 1, { whisperId: 'old', ageSeconds: 3 * 3600 })

    await assertSucceeds(
      (await acceptBatch(await userDb('bob'), { inviteeId: 'bob', whisperId: 'w1', inviteeSlot: 1 })).commit(),
    )
    expect((await getDoc(doc(admin, 'whispers', 'w1'))).data()?.status).toBe('accepted')
  })

  it('first message in a thread, sender in probation, clean body, succeeds', async () => {
    const admin = await adminDb()
    await seedUser(admin, 'alice', { ageSeconds: 10 * 60 }) // in probation, so the link check runs
    await seedWhisper(admin, 'w1', {
      inviterId: 'alice', inviteeId: 'bob', status: 'accepted',
      createdAgeS: 40 * 60, acceptedAgeS: AGES.open30S, inviterSlot: 1,
    })
    await assertSucceeds(
      (await messageBatch(await userDb('alice'), { senderId: 'alice', whisperId: 'w1', body: 'hello there' })).commit(),
    )
    expect((await getDoc(doc(admin, 'whispers', 'w1', 'messages', 'msg1'))).exists()).toBe(true)
    expect((await getDoc(doc(admin, 'whispers', 'w1', 'rateLimits', 'alice'))).exists()).toBe(true)
  })

  it('later message (existing rate limit older than 3 seconds), sender in probation, succeeds', async () => {
    const admin = await adminDb()
    await seedUser(admin, 'alice', { ageSeconds: 10 * 60 })
    await seedWhisper(admin, 'w1', {
      inviterId: 'alice', inviteeId: 'bob', status: 'accepted',
      createdAgeS: 40 * 60, acceptedAgeS: AGES.open30S, inviterSlot: 1,
    })
    await seedRateLimit(admin, 'w1', 'alice', 30)
    await assertSucceeds(
      (await messageBatch(await userDb('alice'), {
        senderId: 'alice', whisperId: 'w1', messageId: 'm2', body: 'hello again',
      })).commit(),
    )
  })

  it('first message from the invitee, with a block entry absent and both users present, succeeds', async () => {
    const admin = await adminDb()
    await seedUser(admin, 'bob', { ageSeconds: 10 * 60 })
    await seedWhisper(admin, 'w1', {
      inviterId: 'alice', inviteeId: 'bob', status: 'accepted',
      createdAgeS: 40 * 60, acceptedAgeS: AGES.open30S, inviterSlot: 1,
    })
    await assertSucceeds(
      (await messageBatch(await userDb('bob'), { senderId: 'bob', whisperId: 'w1' })).commit(),
    )
  })
})
