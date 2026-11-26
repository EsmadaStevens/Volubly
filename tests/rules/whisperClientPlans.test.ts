import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { doc, getDoc, Timestamp } from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'
import { adminDb, assertFails, assertSucceeds, clearData, teardown, userDb } from './helpers.js'
import { AGES, seedBlock, seedRateLimit, seedUser, seedWhisper, seedWhisperSlot } from './whisperHelpers.js'
import { applyPlan, commitPlan } from '../../src/lib/whisperApply'
import {
  planAccept,
  planBlock,
  planCancel,
  planDecline,
  planEnd,
  planInvite,
  planMessage,
  planUnblock,
  type Op,
  type Plan,
  type PlanValue,
} from '../../src/lib/whisperPlans'
import { EXPIRES_HINT_MS, type SlotNumber } from '../../src/lib/whisperTypes'
import { isOnline } from '../../src/lib/whisperWrite'

/*
 * Contract test: the client's own write plans, run through the client's own applyPlan, against the
 * real firestore.rules. There is no second copy of the plan-to-batch conversion here. If a plan
 * drifts from the rules, one of these fails.
 *
 * Every plan has a positive control (the unmodified plan is accepted). Every denied variant differs
 * from it by one change, is shown to be refused, writes nothing, and is followed by the unmodified
 * plan being accepted.
 *
 * The two worst-case batches (10 of 20 lookups) are tested through the client's plans:
 * an invite that reuses a slot and an accept that reuses a slot.
 */

beforeEach(async () => {
  await clearData()
  const admin = await adminDb()
  await seedUser(admin, 'alice')
  await seedUser(admin, 'bob')
  await seedUser(admin, 'carol')
})
afterAll(teardown)

// ---------------------------------------------------------------- plan editing helpers
function editOp(plan: Plan, i: number, f: (op: Exclude<Op, { kind: 'delete' }>) => Op): Plan {
  return plan.map((op, k) => {
    if (k !== i) return op
    if (op.kind === 'delete') throw new Error('cannot edit the data of a delete')
    return f(op)
  })
}
const withField = (plan: Plan, i: number, key: string, value: PlanValue): Plan =>
  editOp(plan, i, (op) => ({ ...op, data: { ...op.data, [key]: value } }))
const withoutField = (plan: Plan, i: number, key: string): Plan =>
  editOp(plan, i, (op) => {
    const data = { ...op.data }
    delete data[key]
    return { ...op, data }
  })
const withPath = (plan: Plan, i: number, path: string[]): Plan => plan.map((op, k) => (k === i ? { ...op, path } : op))

const inMinutes = (m: number) => Timestamp.fromMillis(Date.now() + m * 60_000)

async function stored(path: string[]) {
  const admin = await adminDb()
  return (await getDoc(doc(admin, path[0], ...path.slice(1)))).data()
}
async function exists(path: string[]) {
  const admin = await adminDb()
  return (await getDoc(doc(admin, path[0], ...path.slice(1)))).exists()
}

/** Denied variant is refused and writes nothing at `probePaths`; then the unmodified plan is accepted. */
async function deniedThenControl(db: Firestore, variant: Plan, control: Plan, probePaths: string[][]) {
  await assertFails(applyPlan(db, variant))
  for (const p of probePaths) expect(await stored(p), `a refused batch must leave ${p.join('/')} as it was`).toEqual(before.get(p.join('/')))
  await assertSucceeds(applyPlan(db, control))
}
// what each probed document looked like before the variant ran
const before = new Map<string, unknown>()
async function snapshot(paths: string[][]) {
  before.clear()
  for (const p of paths) before.set(p.join('/'), await stored(p))
}

// ---------------------------------------------------------------- invite
describe('invite plan', () => {
  const invitePlan = (slot: SlotNumber = 1, wid = 'w1') =>
    planInvite({ uid: 'alice', inviteeId: 'bob', whisperId: wid, slot, expiresAt: Timestamp.fromMillis(Date.now() + EXPIRES_HINT_MS) })
  const probes = [['whispers', 'w1'], ['whisperSlots', 'alice_1'], ['whisperSlots', 'alice_2']]

  it('is accepted (positive control), and writes the Whisper and slot', async () => {
    await assertSucceeds(applyPlan(await userDb('alice'), invitePlan(1)))
    expect((await stored(['whispers', 'w1']))?.status).toBe('requested')
    expect((await stored(['whisperSlots', 'alice_1']))?.whisperId).toBe('w1')
  })

  it('WORST CASE: an invite that reuses a slot (10 of 20 lookups) is accepted', async () => {
    const admin = await adminDb()
    await seedWhisper(admin, 'old', { inviterId: 'alice', inviteeId: 'bob', status: 'ended', createdAgeS: 3 * 3600, endedBy: 'alice', inviterSlot: 1 })
    await seedWhisperSlot(admin, 'alice', 1, { whisperId: 'old', ageSeconds: 3 * 3600 })
    await assertSucceeds(applyPlan(await userDb('alice'), invitePlan(1)))
    expect((await stored(['whisperSlots', 'alice_1']))?.whisperId).toBe('w1')
  })

  it('a slot that is still in use is refused, and the same plan on a free slot is accepted', async () => {
    const admin = await adminDb()
    await seedWhisper(admin, 'busy', { inviterId: 'alice', inviteeId: 'carol', status: 'requested', createdAgeS: AGES.pendingValidS, inviterSlot: 1 })
    await seedWhisperSlot(admin, 'alice', 1, { whisperId: 'busy', ageSeconds: AGES.pendingValidS })
    const db = await userDb('alice')
    await assertFails(applyPlan(db, invitePlan(1)))
    await assertSucceeds(applyPlan(db, invitePlan(2)))
  })

  const variants: Array<[string, (p: Plan) => Plan]> = [
    ['the slot is a different number from the one the Whisper names', (p) => withPath(p, 1, ['whisperSlots', 'alice_2'])],
    ["the slot is another person's", (p) => withPath(p, 1, ['whisperSlots', 'bob_1'])],
    ['an extra field on the Whisper', (p) => withField(p, 0, 'extra', 'x')],
    ['an extra field on the slot', (p) => withField(p, 1, 'extra', 'x')],
    ['a missing field on the Whisper (endedBy)', (p) => withoutField(p, 0, 'endedBy')],
    ['a missing field on the Whisper (inviteeSlot)', (p) => withoutField(p, 0, 'inviteeSlot')],
    ['a missing field on the slot (userId)', (p) => withoutField(p, 1, 'userId')],
    ["the slot's expiresAt does not match the Whisper's", (p) => withField(p, 1, 'expiresAt', inMinutes(30))],
    ["the Whisper's expiresAt is below the allowed window (and the slot matches it)", (p) => withField(withField(p, 0, 'expiresAt', inMinutes(60)), 1, 'expiresAt', inMinutes(60))],
    ["the Whisper's expiresAt is above the allowed window (and the slot matches it)", (p) => withField(withField(p, 0, 'expiresAt', inMinutes(180)), 1, 'expiresAt', inMinutes(180))],
    ['the slot write is missing', (p) => p.slice(0, 1)],
    ['the Whisper write is missing', (p) => p.slice(1)],
  ]
  it.each(variants)('is refused when %s, and the unmodified plan is accepted', async (_name, mutate) => {
    const control = invitePlan(1)
    await snapshot(probes)
    await deniedThenControl(await userDb('alice'), mutate(control), control, probes)
  })
})

// ---------------------------------------------------------------- accept
describe('accept plan', () => {
  const probes = [['whispers', 'w1'], ['whisperSlots', 'bob_1'], ['whisperSlots', 'bob_2']]

  async function pendingInvite() {
    const admin = await adminDb()
    const expiresAt = await seedWhisper(admin, 'w1', { inviterId: 'alice', inviteeId: 'bob', status: 'requested', createdAgeS: AGES.pendingValidS, inviterSlot: 1 })
    await seedWhisperSlot(admin, 'alice', 1, { whisperId: 'w1', ageSeconds: AGES.pendingValidS, expiresAt })
    return { id: 'w1', expiresAt }
  }
  const acceptPlan = (w: { id: string; expiresAt: Timestamp }, slot: SlotNumber = 1) => planAccept({ uid: 'bob', whisper: w, slot })

  it('is accepted (positive control), and opens the thread', async () => {
    const w = await pendingInvite()
    await assertSucceeds(applyPlan(await userDb('bob'), acceptPlan(w)))
    const data = await stored(['whispers', 'w1'])
    expect(data?.status).toBe('accepted')
    expect(data?.inviteeSlot).toBe(1)
    expect((await stored(['whisperSlots', 'bob_1']))?.whisperId).toBe('w1')
  })

  it('WORST CASE: an accept that reuses a slot (10 of 20 lookups) is accepted', async () => {
    const w = await pendingInvite()
    const admin = await adminDb()
    await seedWhisper(admin, 'old', { inviterId: 'carol', inviteeId: 'bob', status: 'ended', createdAgeS: 3 * 3600, endedBy: 'bob', inviterSlot: 1 })
    await seedWhisperSlot(admin, 'bob', 1, { whisperId: 'old', ageSeconds: 3 * 3600 })
    await assertSucceeds(applyPlan(await userDb('bob'), acceptPlan(w)))
    expect((await stored(['whispers', 'w1']))?.status).toBe('accepted')
    expect((await stored(['whisperSlots', 'bob_1']))?.whisperId).toBe('w1')
  })

  const variants: Array<[string, (p: Plan) => Plan]> = [
    ['the slot is a different number from inviteeSlot', (p) => withPath(p, 1, ['whisperSlots', 'bob_2'])],
    ["the slot is another person's", (p) => withPath(p, 1, ['whisperSlots', 'alice_2'])],
    ['an extra field on the update', (p) => withField(p, 0, 'extra', 'x')],
    ['an extra field on the slot', (p) => withField(p, 1, 'extra', 'x')],
    ['a missing field on the update (inviteeSlot)', (p) => withoutField(p, 0, 'inviteeSlot')],
    ['a missing field on the update (acceptedAt)', (p) => withoutField(p, 0, 'acceptedAt')],
    ['a missing field on the slot (openedAt)', (p) => withoutField(p, 1, 'openedAt')],
    ["the slot's expiresAt does not match the Whisper's", (p) => withField(p, 1, 'expiresAt', inMinutes(30))],
    ['the slot write is missing', (p) => p.slice(0, 1)],
  ]
  it.each(variants)('is refused when %s, and the unmodified plan is accepted', async (_name, mutate) => {
    const w = await pendingInvite()
    const control = acceptPlan(w)
    await snapshot(probes)
    await deniedThenControl(await userDb('bob'), mutate(control), control, probes)
  })
})

// ---------------------------------------------------------------- decline, cancel, end
describe('decline, cancel and end plans', () => {
  async function pending() {
    const admin = await adminDb()
    await seedWhisper(admin, 'w1', { inviterId: 'alice', inviteeId: 'bob', status: 'requested', createdAgeS: AGES.pendingValidS })
  }
  async function open() {
    const admin = await adminDb()
    await seedWhisper(admin, 'w1', { inviterId: 'alice', inviteeId: 'bob', status: 'accepted', createdAgeS: 20 * 60, acceptedAgeS: 10 * 60, inviterSlot: 1, inviteeSlot: 1 })
  }
  const probes = [['whispers', 'w1']]

  it('decline by the invitee is accepted; an extra field and a wrong status are refused first', async () => {
    await pending()
    const control = planDecline('w1')
    await snapshot(probes)
    const db = await userDb('bob')
    await deniedThenControl(db, withField(control, 0, 'extra', 'x'), control, probes)
    expect((await stored(['whispers', 'w1']))?.status).toBe('declined')
  })
  it('decline refuses a wrong status (ended) from the invitee', async () => {
    await pending()
    await snapshot(probes)
    await deniedThenControl(await userDb('bob'), withField(planDecline('w1'), 0, 'status', 'ended'), planDecline('w1'), probes)
  })

  it('cancel by the inviter is accepted; an extra field, a missing endedBy and a wrong endedBy are refused first', async () => {
    await pending()
    const control = planCancel({ uid: 'alice', whisperId: 'w1' })
    await snapshot(probes)
    const db = await userDb('alice')
    await assertFails(applyPlan(db, withField(control, 0, 'extra', 'x')))
    await assertFails(applyPlan(db, withoutField(control, 0, 'endedBy')))
    await assertFails(applyPlan(db, withField(control, 0, 'endedBy', 'bob')))
    expect(await stored(['whispers', 'w1'])).toEqual(before.get('whispers/w1'))
    await assertSucceeds(applyPlan(db, control))
    expect((await stored(['whispers', 'w1']))?.endedBy).toBe('alice')
  })

  it.each([['alice'], ['bob']])('end by %s is accepted; an extra field, a missing endedBy and a wrong endedBy are refused first', async (who) => {
    await open()
    const other = who === 'alice' ? 'bob' : 'alice'
    const control = planEnd({ uid: who, whisperId: 'w1' })
    await snapshot(probes)
    const db = await userDb(who)
    await assertFails(applyPlan(db, withField(control, 0, 'extra', 'x')))
    await assertFails(applyPlan(db, withoutField(control, 0, 'endedBy')))
    await assertFails(applyPlan(db, withField(control, 0, 'endedBy', other)))
    expect(await stored(['whispers', 'w1'])).toEqual(before.get('whispers/w1'))
    await assertSucceeds(applyPlan(db, control))
    expect(await stored(['whispers', 'w1'])).toMatchObject({ status: 'ended', endedBy: who })
  })
})

// ---------------------------------------------------------------- block and unblock
describe('block and unblock plans', () => {
  async function open() {
    const admin = await adminDb()
    await seedWhisper(admin, 'w1', { inviterId: 'alice', inviteeId: 'bob', status: 'accepted', createdAgeS: 20 * 60, acceptedAgeS: 10 * 60, inviterSlot: 1, inviteeSlot: 1 })
  }
  const accepted = { id: 'w1', status: 'accepted' as const, inviterId: 'alice', inviteeId: 'bob' }
  const probes = [['whispers', 'w1'], ['users', 'bob', 'blocked', 'alice']]

  it('end and block in one batch is accepted, and both happen', async () => {
    await open()
    await assertSucceeds(applyPlan(await userDb('bob'), planBlock({ uid: 'bob', otherId: 'alice', whisper: accepted })))
    expect(await stored(['whispers', 'w1'])).toMatchObject({ status: 'ended', endedBy: 'bob' })
    expect((await stored(['users', 'bob', 'blocked', 'alice']))?.blockedId).toBe('alice')
  })

  it('decline and block on a pending invite is accepted', async () => {
    const admin = await adminDb()
    await seedWhisper(admin, 'w1', { inviterId: 'alice', inviteeId: 'bob', status: 'requested', createdAgeS: AGES.pendingValidS })
    await assertSucceeds(
      applyPlan(await userDb('bob'), planBlock({ uid: 'bob', otherId: 'alice', whisper: { id: 'w1', status: 'requested', inviterId: 'alice', inviteeId: 'bob' } })),
    )
    expect((await stored(['whispers', 'w1']))?.status).toBe('declined')
    expect(await exists(['users', 'bob', 'blocked', 'alice'])).toBe(true)
  })

  it('block alone, for a whisper that is already over, is accepted', async () => {
    const admin = await adminDb()
    await seedWhisper(admin, 'w1', { inviterId: 'alice', inviteeId: 'bob', status: 'ended', createdAgeS: 3600, endedBy: 'alice' })
    const plan = planBlock({ uid: 'bob', otherId: 'alice', whisper: { id: 'w1', status: 'ended', inviterId: 'alice', inviteeId: 'bob' } })
    expect(plan).toHaveLength(1)
    await assertSucceeds(applyPlan(await userDb('bob'), plan))
  })

  const variants: Array<[string, (p: Plan) => Plan]> = [
    ['an extra field on the block entry', (p) => withField(p, 1, 'extra', 'x')],
    ['the block entry has no blockedAt', (p) => withoutField(p, 1, 'blockedAt')],
    ['blockedId differs from the document id', (p) => withField(p, 1, 'blockedId', 'carol')],
    ['the block is for the person themselves', (p) => withPath(withField(p, 1, 'blockedId', 'bob'), 1, ['users', 'bob', 'blocked', 'bob'])],
  ]
  it.each(variants)('is refused when %s, the whole batch (including the end) is not applied, and the unmodified plan is accepted', async (_name, mutate) => {
    await open()
    const control = planBlock({ uid: 'bob', otherId: 'alice', whisper: accepted })
    await snapshot(probes)
    await deniedThenControl(await userDb('bob'), mutate(control), control, probes)
  })

  it('unblock by the owner is accepted; another person doing the same is refused first', async () => {
    const admin = await adminDb()
    await seedBlock(admin, 'bob', 'alice')
    const plan = planUnblock({ uid: 'bob', otherId: 'alice' })
    await assertFails(applyPlan(await userDb('carol'), plan))
    expect(await exists(['users', 'bob', 'blocked', 'alice'])).toBe(true)
    await assertSucceeds(applyPlan(await userDb('bob'), plan))
    expect(await exists(['users', 'bob', 'blocked', 'alice'])).toBe(false)
  })
})

// ---------------------------------------------------------------- messages
describe('message plan', () => {
  async function openThread() {
    const admin = await adminDb()
    const expiresAt = await seedWhisper(admin, 'w1', { inviterId: 'alice', inviteeId: 'bob', status: 'accepted', createdAgeS: 20 * 60, acceptedAgeS: 10 * 60, inviterSlot: 1, inviteeSlot: 1 })
    return { id: 'w1', expiresAt }
  }
  const messagePlan = (w: { id: string; expiresAt: Timestamp }, messageId = 'm1') => planMessage({ uid: 'bob', whisper: w, messageId, body: 'hello' })
  const probes = [['whispers', 'w1', 'messages', 'm1'], ['whispers', 'w1', 'rateLimits', 'bob']]

  it('the first message (message plus new rate limit) is accepted', async () => {
    const w = await openThread()
    await assertSucceeds(applyPlan(await userDb('bob'), messagePlan(w)))
    expect((await stored(['whispers', 'w1', 'messages', 'm1']))?.body).toBe('hello')
    expect(await exists(['whispers', 'w1', 'rateLimits', 'bob'])).toBe(true)
  })

  it('a later message (message plus updated rate limit) is accepted', async () => {
    const w = await openThread()
    const admin = await adminDb()
    await seedRateLimit(admin, 'w1', 'bob', 10)
    await assertSucceeds(applyPlan(await userDb('bob'), messagePlan(w, 'm2')))
    expect(await exists(['whispers', 'w1', 'messages', 'm2'])).toBe(true)
  })

  const variants: Array<[string, (p: Plan) => Plan]> = [
    ['an extra field on the message', (p) => withField(p, 0, 'extra', 'x')],
    ['a missing field on the message (whisperId)', (p) => withoutField(p, 0, 'whisperId')],
    ['a missing field on the message (sentAt)', (p) => withoutField(p, 0, 'sentAt')],
    ["the message's expiresAt does not match the Whisper's", (p) => withField(p, 0, 'expiresAt', inMinutes(30))],
    ['an extra field on the rate limit', (p) => withField(p, 1, 'extra', 'x')],
    ['a missing field on the rate limit (lastMessageAt)', (p) => withoutField(p, 1, 'lastMessageAt')],
    ["the rate limit's expiresAt does not match the Whisper's", (p) => withField(p, 1, 'expiresAt', inMinutes(30))],
    ['the rate-limit write is missing', (p) => p.slice(0, 1)],
    ['the message is sent as someone else', (p) => withField(p, 0, 'senderId', 'alice')],
  ]
  it.each(variants)('is refused when %s, and the unmodified plan is accepted', async (_name, mutate) => {
    const w = await openThread()
    const control = messagePlan(w)
    await snapshot(probes)
    await deniedThenControl(await userDb('bob'), mutate(control), control, probes)
  })
})

// ---------------------------------------------------------------- the guarded commit, under Node
describe('commitPlan (the offline check and the timeout) under Node', () => {
  it('treats a missing navigator.onLine as online, so a valid plan is accepted', async () => {
    expect(isOnline()).toBe(true)
    const plan = planInvite({ uid: 'alice', inviteeId: 'bob', whisperId: 'w1', slot: 1, expiresAt: Timestamp.fromMillis(Date.now() + EXPIRES_HINT_MS) })
    expect(await commitPlan(await userDb('alice'), plan)).toEqual({ ok: true })
    expect((await stored(['whispers', 'w1']))?.inviterId).toBe('alice')
  })

  it('turns a refusal by the rules into the generic result, carrying the code for the console', async () => {
    const plan = withField(
      planInvite({ uid: 'alice', inviteeId: 'bob', whisperId: 'w1', slot: 1, expiresAt: Timestamp.fromMillis(Date.now() + EXPIRES_HINT_MS) }),
      0,
      'extra',
      'x',
    )
    const r = await commitPlan(await userDb('alice'), plan)
    expect(r).toMatchObject({ ok: false, code: 'generic' })
    expect(await exists(['whispers', 'w1'])).toBe(false)
  })

  it('offline writes nothing', async () => {
    const plan = planInvite({ uid: 'alice', inviteeId: 'bob', whisperId: 'w1', slot: 1, expiresAt: Timestamp.fromMillis(Date.now() + EXPIRES_HINT_MS) })
    expect(await commitPlan(await userDb('alice'), plan, { online: false })).toEqual({ ok: false, code: 'generic', reason: 'offline' })
    expect(await exists(['whispers', 'w1'])).toBe(false)
  })
})
