import { describe, it, expect, afterAll } from 'vitest'
import * as fc from 'fast-check'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'
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
  acceptBatch,
  inviteBatch,
  messageBatch,
  seedRateLimit,
  seedUser,
  seedWhisper,
  seedWhisperSlot,
  type Band,
  type WhisperStatus,
} from './whisperHelpers.js'

// Property tests against the emulator. numRuns stays at 20 or fewer (each run resets the emulator).
// Time cannot be moved, so ages are generated away from the exact boundaries (1 to 58 minutes is
// open, 62 minutes or more is over). The age band is self-declared; these properties describe what
// the rules do with the stored band, not whether the band is true.

afterAll(teardown)

const RUNS = 20
const TIMEOUT = 180_000

const BANDS: readonly Band[] = ['under_13', '13_17', '18_plus']
const bandArb = fc.constantFrom<Band>(...BANDS)
const pairable = (a: Band, b: Band) => a === b && a !== 'under_13'

async function reset(users: Record<string, Band>): Promise<Firestore> {
  await clearData()
  const admin = await adminDb()
  for (const [uid, band] of Object.entries(users)) await seedUser(admin, uid, { band })
  return admin
}

// ---------------------------------------------------------------- property 1

describe('Feature: whisper-threads, Property 1: message window', () => {
  const statusArb = fc.constantFrom<WhisperStatus>('requested', 'accepted', 'declined', 'ended')
  const ageArb = fc.oneof(
    fc.integer({ min: 1, max: 58 }).map((m) => ({ m, open: true })),
    fc.integer({ min: 62, max: 300 }).map((m) => ({ m, open: false })),
  )

  it(
    'a message is accepted only while the thread is accepted and under one hour old',
    async () => {
      await fc.assert(
        fc.asyncProperty(statusArb, ageArb, async (status, age) => {
          const admin = await reset({ alice: '18_plus', bob: '18_plus' })
          const hasAccepted = status === 'accepted' || status === 'ended'
          await seedWhisper(admin, 'w1', {
            inviterId: 'alice',
            inviteeId: 'bob',
            status,
            createdAgeS: hasAccepted ? age.m * 60 + 60 : age.m * 60,
            acceptedAgeS: hasAccepted ? age.m * 60 : undefined,
            endedBy: status === 'ended' ? 'alice' : null,
            inviterSlot: 1,
          })
          const db = await userDb('alice')
          const attempt = (await messageBatch(db, { senderId: 'alice', whisperId: 'w1' })).commit()
          if (status === 'accepted' && age.open) await assertSucceeds(attempt)
          else await assertFails(attempt)
        }),
        { numRuns: RUNS },
      )
    },
    TIMEOUT,
  )
})

// ---------------------------------------------------------------- property 2

describe('Feature: whisper-threads, Property 2: age pairing', () => {
  it(
    'a thread reaches accepted only when both stored bands match and are not under_13, in any order',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            invite: fc.tuple(bandArb, bandArb),
            accept: fc.tuple(bandArb, bandArb),
            viaInvite: fc.boolean(),
          }),
          async ({ invite, accept, viaInvite }) => {
            const admin = await reset({ alice: invite[0], bob: invite[1] })

            if (viaInvite) {
              const attempt = inviteBatch(await userDb('alice'), {
                inviterId: 'alice', inviteeId: 'bob', whisperId: 'w1',
              }).commit()
              if (pairable(invite[0], invite[1])) await assertSucceeds(attempt)
              else {
                await assertFails(attempt)
                expect((await getDoc(doc(admin, 'whispers', 'w1'))).exists()).toBe(false)
                return // nothing to accept
              }
            } else {
              // As if the invite had been made when the bands matched.
              await seedWhisper(admin, 'w1', {
                inviterId: 'alice', inviteeId: 'bob', status: 'requested', createdAgeS: 5 * 60, inviterSlot: 1,
              })
            }

            // The stored bands may differ at accept time.
            await seedUser(admin, 'alice', { band: accept[0] })
            await seedUser(admin, 'bob', { band: accept[1] })
            const accepting = (await acceptBatch(await userDb('bob'), {
              inviteeId: 'bob', whisperId: 'w1',
            })).commit()
            if (pairable(accept[0], accept[1])) await assertSucceeds(accepting)
            else await assertFails(accepting)

            const status = (await getDoc(doc(admin, 'whispers', 'w1'))).data()?.status
            if (status === 'accepted') expect(pairable(accept[0], accept[1])).toBe(true)
          },
        ),
        { numRuns: RUNS },
      )
    },
    TIMEOUT,
  )
})

// ---------------------------------------------------------------- property 3

describe('Feature: whisper-threads, Property 3: non-member access', () => {
  const statusArb = fc.constantFrom<WhisperStatus>('requested', 'accepted', 'declined', 'ended')
  const whoArb = fc.constantFrom('carol', 'mallory', 'unauth')

  it(
    'a non-member can neither read nor write any whisper data, and the data is unchanged',
    async () => {
      await fc.assert(
        fc.asyncProperty(statusArb, whoArb, async (status, who) => {
          const admin = await reset({ alice: '18_plus', bob: '18_plus', carol: '18_plus', mallory: '18_plus' })
          const hasAccepted = status === 'accepted' || status === 'ended'
          const expiresAt = await seedWhisper(admin, 'w1', {
            inviterId: 'alice',
            inviteeId: 'bob',
            status,
            createdAgeS: hasAccepted ? 40 * 60 : 5 * 60,
            acceptedAgeS: hasAccepted ? 30 * 60 : undefined,
            endedBy: status === 'ended' ? 'alice' : null,
            inviterSlot: 1,
          })
          await setDoc(doc(admin, 'whispers', 'w1', 'messages', 'm1'), {
            messageId: 'm1', senderId: 'alice', body: 'hello', sentAt: new Date(), whisperId: 'w1', expiresAt,
          })
          await seedRateLimit(admin, 'w1', 'alice', 60)

          const snapshot = async () => {
            const paths: [string, ...string[]][] = [
              ['whispers', 'w1'],
              ['whispers', 'w1', 'messages', 'm1'],
              ['whispers', 'w1', 'rateLimits', 'alice'],
            ]
            const out: unknown[] = []
            for (const [first, ...rest] of paths) out.push((await getDoc(doc(admin, first, ...rest))).data() ?? null)
            return JSON.stringify(out)
          }
          const before = await snapshot()

          const db = who === 'unauth' ? await unauthDb() : await userDb(who)
          const me = who === 'unauth' ? 'nobody' : who
          const w = doc(db, 'whispers', 'w1')
          const msg = doc(db, 'whispers', 'w1', 'messages', 'm1')
          const rl = (uid: string) => doc(db, 'whispers', 'w1', 'rateLimits', uid)
          const fresh = {
            userId: me, lastMessageAt: serverTimestamp(), expiresAt,
          }

          await assertFails(getDoc(w))
          await assertFails(getDocs(query(collection(db, 'whispers'), where('memberIds', 'array-contains', 'alice'))))
          await assertFails(updateDoc(w, { status: 'ended', endedBy: me }))
          await assertFails(deleteDoc(w))
          await assertFails(
            setDoc(w, {
              inviterId: me, inviteeId: 'bob', memberIds: [me, 'bob'], status: 'requested',
              createdAt: serverTimestamp(), acceptedAt: null, endedBy: null, inviterSlot: 1, inviteeSlot: null, expiresAt,
            }),
          )
          await assertFails(getDoc(msg))
          await assertFails(getDocs(collection(db, 'whispers', 'w1', 'messages')))
          await assertFails(
            setDoc(doc(db, 'whispers', 'w1', 'messages', 'm2'), {
              messageId: 'm2', senderId: me, body: 'hi', sentAt: serverTimestamp(), whisperId: 'w1', expiresAt,
            }),
          )
          await assertFails(updateDoc(msg, { body: 'edited' }))
          await assertFails(deleteDoc(msg))
          await assertFails(setDoc(rl(me), fresh))
          await assertFails(getDoc(rl('alice')))
          await assertFails(setDoc(rl('alice'), { ...fresh, userId: 'alice' }))
          await assertFails(deleteDoc(rl('alice')))

          expect(await snapshot()).toBe(before)
          expect((await getDoc(doc(admin, 'whispers', 'w1', 'messages', 'm2'))).exists()).toBe(false)
        }),
        { numRuns: RUNS },
      )
    },
    TIMEOUT,
  )
})

// ---------------------------------------------------------------- property 4

describe('Feature: whisper-threads, Property 4: open whisper cap', () => {
  type SlotState =
    | { kind: 'missing' }
    | { kind: 'open'; how: 'pending' | 'accepted'; min: number }
    | { kind: 'over'; how: 'declined' | 'ended' | 'stale' | 'hour'; min: number }

  const slotStateArb: fc.Arbitrary<SlotState> = fc.oneof(
    fc.constant<SlotState>({ kind: 'missing' }),
    fc.integer({ min: 1, max: 13 }).map<SlotState>((min) => ({ kind: 'open', how: 'pending', min })),
    fc.integer({ min: 1, max: 55 }).map<SlotState>((min) => ({ kind: 'open', how: 'accepted', min })),
    fc.integer({ min: 1, max: 60 }).map<SlotState>((min) => ({ kind: 'over', how: 'declined', min })),
    fc.integer({ min: 1, max: 60 }).map<SlotState>((min) => ({ kind: 'over', how: 'ended', min })),
    fc.integer({ min: 16, max: 120 }).map<SlotState>((min) => ({ kind: 'over', how: 'stale', min })),
    fc.integer({ min: 62, max: 240 }).map<SlotState>((min) => ({ kind: 'over', how: 'hour', min })),
  )

  async function seedSlotState(admin: Firestore, n: 1 | 2 | 3, s: SlotState): Promise<void> {
    if (s.kind === 'missing') return
    const id = `s${n}`
    const base = { inviterId: 'alice', inviteeId: 'bob', inviterSlot: n }
    let createdAgeS = s.min * 60
    if (s.kind === 'open' && s.how === 'pending') {
      await seedWhisper(admin, id, { ...base, status: 'requested', createdAgeS })
    } else if ((s.kind === 'open' && s.how === 'accepted') || (s.kind === 'over' && s.how === 'hour')) {
      createdAgeS = s.min * 60 + 60
      await seedWhisper(admin, id, { ...base, status: 'accepted', createdAgeS, acceptedAgeS: s.min * 60, inviteeSlot: 1 })
    } else if (s.kind === 'over' && s.how === 'declined') {
      await seedWhisper(admin, id, { ...base, status: 'declined', createdAgeS })
    } else if (s.kind === 'over' && s.how === 'ended') {
      await seedWhisper(admin, id, { ...base, status: 'ended', createdAgeS, endedBy: 'alice' })
    } else {
      await seedWhisper(admin, id, { ...base, status: 'requested', createdAgeS }) // stale
    }
    await seedWhisperSlot(admin, 'alice', n, { whisperId: id, ageSeconds: createdAgeS })
  }

  async function countOpenForAlice(admin: Firestore): Promise<number> {
    const snap = await getDocs(query(collection(admin, 'whispers'), where('memberIds', 'array-contains', 'alice')))
    const now = Date.now()
    let open = 0
    for (const d of snap.docs) {
      const w = d.data()
      const pending = w.status === 'requested' && now - w.createdAt.toMillis() < 15 * 60_000
      const running = w.status === 'accepted' && w.acceptedAt && now - w.acceptedAt.toMillis() < 60 * 60_000
      if (pending || running) open++
    }
    return open
  }

  it(
    'an invite succeeds exactly when the targeted slot is missing or over, and never more than 3 whispers are open',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.tuple(slotStateArb, slotStateArb, slotStateArb),
          fc.array(fc.constantFrom<1 | 2 | 3>(1, 2, 3), { minLength: 1, maxLength: 5 }),
          async (states, attempts) => {
            const admin = await reset({ alice: '18_plus', bob: '18_plus' })
            const open: Record<1 | 2 | 3, boolean> = { 1: false, 2: false, 3: false }
            for (const n of [1, 2, 3] as const) {
              const s = states[n - 1]
              await seedSlotState(admin, n, s)
              open[n] = s.kind === 'open'
            }
            const db = await userDb('alice')
            for (let i = 0; i < attempts.length; i++) {
              const n = attempts[i]
              const attempt = inviteBatch(db, {
                inviterId: 'alice', inviteeId: 'bob', whisperId: `n${i}`, inviterSlot: n,
              }).commit()
              if (open[n]) {
                await assertFails(attempt)
              } else {
                await assertSucceeds(attempt)
                open[n] = true
              }
              const count = await countOpenForAlice(admin)
              expect(count).toBeLessThanOrEqual(3)
              expect(count).toBe(Object.values(open).filter(Boolean).length)
            }
          },
        ),
        { numRuns: RUNS },
      )
    },
    TIMEOUT,
  )
})
