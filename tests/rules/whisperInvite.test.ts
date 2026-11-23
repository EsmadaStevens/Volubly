import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { doc, getDoc, deleteDoc, Timestamp } from 'firebase/firestore'
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
  seedWhisperSlot,
  type Band,
  type InviteOptions,
} from './whisperHelpers.js'

// Every test starts from empty data. Every denial is followed by a positive control that differs
// only in the condition under test. Expiry cases plant backdated documents (request.time cannot
// be moved), with ages that stay away from the exact boundaries.

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

describe('invite', () => {
  it('invite allowed: same band, free slot', async () => {
    const db = await userDb('alice')
    await assertSucceeds(invite(db).commit())
    expect(await docExists('whispers', 'w1')).toBe(true)
    expect(await docExists('whisperSlots', 'alice_1')).toBe(true)
  })

  it('unauthenticated invite denied (control: authenticated)', async () => {
    await assertFails(invite(await unauthDb()).commit())
    expect(await docExists('whispers', 'w1')).toBe(false)
    await assertSucceeds(invite(await userDb('alice')).commit())
  })
})

describe('invite shape', () => {
  const bad: [string, Partial<InviteOptions>][] = [
    ['non-null inviteeSlot', { whisperOverrides: { inviteeSlot: 1 } }],
    ['inviterSlot 0', { inviterSlot: 0 }],
    ['inviterSlot 4', { inviterSlot: 4 }],
    ['expiresAt below +1h15m', { whisperOverrides: { expiresAt: Timestamp.fromMillis(Date.now() + 60 * MIN_MS) } }],
    ['expiresAt above +2h', { whisperOverrides: { expiresAt: Timestamp.fromMillis(Date.now() + 180 * MIN_MS) } }],
    ['acceptedAt set', { whisperOverrides: { acceptedAt: Timestamp.now() } }],
    ['endedBy set', { whisperOverrides: { endedBy: 'alice' } }],
    ['status accepted', { whisperOverrides: { status: 'accepted' } }],
    ['createdAt not request.time', { whisperOverrides: { createdAt: Timestamp.fromMillis(Date.now() - 5000) } }],
    ['extra field', { whisperOverrides: { extra: true } }],
    ['missing field', { whisperOverrides: { endedBy: undefined } }],
    ['inviteeId equals inviterId', { inviteeId: 'alice' }],
    ['inviterId is someone else', { whisperOverrides: { inviterId: 'bob' } }],
    ['memberIds in the wrong order', { whisperOverrides: { memberIds: ['bob', 'alice'] } }],
    ['memberIds with a third uid', { whisperOverrides: { memberIds: ['alice', 'bob', 'carol'] } }],
    ['slot id of another user', { slotId: 'bob_1' }],
    ['slot userId of another user', { slotOverrides: { userId: 'bob' } }],
    ['slot written with a different whisperId', { slotOverrides: { whisperId: 'other' } }],
  ]

  it.each(bad)('%s denied, valid control allowed', async (_name, extra) => {
    const db = await userDb('alice')
    await assertFails(invite(db, extra).commit())
    expect(await docExists('whispers', 'w1')).toBe(false)
    expect(await docExists('whisperSlots', 'alice_1')).toBe(false)
    await assertSucceeds(invite(db).commit())
    expect(await docExists('whispers', 'w1')).toBe(true)
  })

  it.each([1, 2, 3] as const)('inviterSlot %i allowed', async (n) => {
    await assertSucceeds(invite(await userDb('alice'), { inviterSlot: n }).commit())
    expect(await docExists('whisperSlots', `alice_${n}`)).toBe(true)
  })
})

describe('invite age bands (the band is self-declared; best-effort only)', () => {
  const mismatched: [Band, Band][] = [
    ['13_17', '18_plus'],
    ['18_plus', '13_17'],
    ['under_13', 'under_13'],
    ['under_13', '18_plus'],
    ['18_plus', 'under_13'],
    ['13_17', 'under_13'],
  ]

  it.each(mismatched)('inviter %s with invitee %s denied; same band 13_17 allowed', async (a, b) => {
    const admin = await adminDb()
    await seedUser(admin, 'alice', { band: a })
    await seedUser(admin, 'bob', { band: b })
    const db = await userDb('alice')
    await assertFails(invite(db).commit())
    expect(await docExists('whispers', 'w1')).toBe(false)

    await seedUser(admin, 'alice', { band: '13_17' })
    await seedUser(admin, 'bob', { band: '13_17' })
    await assertSucceeds(invite(db).commit())
  })

  it.each(['13_17', '18_plus'] as const)('both %s allowed', async (band) => {
    const admin = await adminDb()
    await seedUser(admin, 'alice', { band })
    await seedUser(admin, 'bob', { band })
    await assertSucceeds(invite(await userDb('alice')).commit())
  })

  it('invitee without a users document denied (control: with one)', async () => {
    const admin = await adminDb()
    await deleteDoc(doc(admin, 'users', 'bob'))
    const db = await userDb('alice')
    await assertFails(invite(db).commit())
    await seedUser(admin, 'bob')
    await assertSucceeds(invite(db).commit())
  })
})

describe('invite blocks', () => {
  it('invite to someone who blocked the inviter denied; without the block allowed', async () => {
    const admin = await adminDb()
    await seedBlock(admin, 'bob', 'alice')
    const db = await userDb('alice')
    await assertFails(invite(db).commit())
    await deleteDoc(doc(admin, 'users', 'bob', 'blocked', 'alice'))
    await assertSucceeds(invite(db).commit())
  })

  it('invite to someone the inviter blocked denied; without the block allowed', async () => {
    const admin = await adminDb()
    await seedBlock(admin, 'alice', 'bob')
    const db = await userDb('alice')
    await assertFails(invite(db).commit())
    await deleteDoc(doc(admin, 'users', 'alice', 'blocked', 'bob'))
    await assertSucceeds(invite(db).commit())
  })

  it('a block by a third person does not stop the invite', async () => {
    const admin = await adminDb()
    await seedBlock(admin, 'carol', 'alice')
    await assertSucceeds(invite(await userDb('alice')).commit())
  })
})

describe('open whisper cap (3 slots)', () => {
  async function seedThreeOpen() {
    const admin = await adminDb()
    // slot 1: pending invite, 14 minutes old
    await seedWhisper(admin, 'h1', {
      inviterId: 'alice', inviteeId: 'bob', status: 'requested',
      createdAgeS: AGES.pendingValidS, inviterSlot: 1,
    })
    await seedWhisperSlot(admin, 'alice', 1, { whisperId: 'h1', ageSeconds: AGES.pendingValidS })
    // slot 2: accepted 30 minutes ago
    await seedWhisper(admin, 'h2', {
      inviterId: 'alice', inviteeId: 'bob', status: 'accepted',
      createdAgeS: 35 * 60, acceptedAgeS: AGES.open30S, inviterSlot: 2,
    })
    await seedWhisperSlot(admin, 'alice', 2, { whisperId: 'h2', ageSeconds: 35 * 60 })
    // slot 3: accepted 55 minutes ago
    await seedWhisper(admin, 'h3', {
      inviterId: 'alice', inviteeId: 'bob', status: 'accepted',
      createdAgeS: 58 * 60, acceptedAgeS: 55 * 60, inviterSlot: 3,
    })
    await seedWhisperSlot(admin, 'alice', 3, { whisperId: 'h3', ageSeconds: 58 * 60 })
  }

  it('fourth open whisper denied in every slot; a free third slot allowed', async () => {
    await seedThreeOpen()
    const db = await userDb('alice')
    for (const n of [1, 2, 3]) {
      await assertFails(invite(db, { inviterSlot: n }).commit())
    }
    expect(await docExists('whispers', 'w1')).toBe(false)

    // Control: the same person with only two slots held can open a third whisper.
    const admin = await adminDb()
    await deleteDoc(doc(admin, 'whisperSlots', 'alice_3'))
    await assertSucceeds(invite(db, { inviterSlot: 3 }).commit())
    expect(await docExists('whispers', 'w1')).toBe(true)
  })

  it('the invitee side is not affected by the inviter holding three whispers with someone else', async () => {
    await seedThreeOpen()
    // bob is not the inviter here; he can invite carol with his own free slots
    const admin = await adminDb()
    await seedUser(admin, 'carol')
    await assertSucceeds(
      inviteBatch(await userDb('bob'), { inviterId: 'bob', inviteeId: 'carol', whisperId: 'w9' }).commit(),
    )
  })
})
