import { describe, it, expect, afterAll } from 'vitest'
import * as fc from 'fast-check'
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { userADb, adminDb, clearData, teardown, assertFails } from './helpers.js'
import { createRoomBatch, seedSlot, seedUser } from './roomLimitHelpers.js'

afterAll(teardown)

const HOUR_S = 60 * 60
const DAY_MS = 24 * HOUR_S * 1000

type SlotState =
  | { kind: 'missing' }
  | { kind: 'active'; ageSeconds: number }
  | { kind: 'expired'; ageSeconds: number }

// Ages avoid the exact 24h boundary.
const slotStateArb: fc.Arbitrary<SlotState> = fc.oneof(
  fc.constant<SlotState>({ kind: 'missing' }),
  fc
    .integer({ min: 60, max: 23 * HOUR_S })
    .map<SlotState>((ageSeconds) => ({ kind: 'active', ageSeconds })),
  fc
    .integer({ min: 24 * HOUR_S + 60, max: 48 * HOUR_S })
    .map<SlotState>((ageSeconds) => ({ kind: 'expired', ageSeconds })),
)

const scenarioArb = fc.record({
  slot1: slotStateArb,
  slot2: slotStateArb,
  attempts: fc.array(fc.constantFrom<1 | 2>(1, 2), { minLength: 1, maxLength: 4 }),
})

// Feature: room-limit, Property 4: At most two active slots per user
describe('Feature: room-limit, Property 4: At most two active slots per user', () => {
  it(
    'a create succeeds exactly when the targeted slot is missing or expired, and never more than 2 slots are active',
    async () => {
      let runId = 0
      await fc.assert(
        fc.asyncProperty(scenarioArb, async ({ slot1, slot2, attempts }) => {
          runId++
          await clearData()
          const admin = await adminDb()
          await seedUser(admin, 'userA')

          // Model: true = active
          const model: Record<1 | 2, boolean> = { 1: false, 2: false }
          const initial: Array<[1 | 2, SlotState]> = [
            [1, slot1],
            [2, slot2],
          ]
          for (const [n, s] of initial) {
            if (s.kind === 'missing') continue
            await seedSlot(admin, 'userA', n, { ageSeconds: s.ageSeconds })
            model[n] = s.kind === 'active'
          }

          const db = await userADb()
          for (let i = 0; i < attempts.length; i++) {
            const n = attempts[i]
            const expected = !model[n]
            let succeeded = true
            try {
              await createRoomBatch(db, {
                uid: 'userA',
                roomId: `prop-room-${runId}-${i}`,
                slotId: `userA_${n}`,
              }).commit()
            } catch {
              succeeded = false
            }
            expect(succeeded).toBe(expected)
            if (expected) model[n] = true

            // Count active slots from stored openedAt.
            const now = Date.now()
            let active = 0
            for (const k of [1, 2]) {
              const snap = await getDoc(doc(admin, 'roomSlots', `userA_${k}`))
              if (!snap.exists()) continue
              const openedMs = snap.data()!.openedAt.toMillis() as number
              if (openedMs + DAY_MS > now) active++
            }
            expect(active).toBeLessThanOrEqual(2)
          }
        }),
        { numRuns: 20 },
      )
    },
    120_000,
  )
})

// Feature: room-limit, Property 6: Slots are never deleted and unexpired slots are never updated
type ValueSpec =
  | { t: 'ts'; offsetMs: number }
  | { t: 'server' }
  | { t: 'str'; s: string }
  | { t: 'num'; n: number }
  | { t: 'bool'; b: boolean }
  | { t: 'null' }
  | { t: 'sameRoom' }
  | { t: 'ownUid' }

type FieldOp = { op: 'keep' } | { op: 'drop' } | { op: 'set'; v: ValueSpec }

const valueArb: fc.Arbitrary<ValueSpec> = fc.oneof(
  // Past, future and near the seeded openedAt.
  fc.integer({ min: -3 * DAY_MS, max: 3 * DAY_MS }).map<ValueSpec>((offsetMs) => ({ t: 'ts', offsetMs })),
  fc.integer({ min: -2000, max: 2000 }).map<ValueSpec>((offsetMs) => ({ t: 'ts', offsetMs })),
  fc.constant<ValueSpec>({ t: 'server' }),
  fc.string({ maxLength: 12 }).map<ValueSpec>((s) => ({ t: 'str', s })),
  fc.constant<ValueSpec>({ t: 'str', s: '' }),
  fc.integer().map<ValueSpec>((n) => ({ t: 'num', n })),
  fc.boolean().map<ValueSpec>((b) => ({ t: 'bool', b })),
  fc.constant<ValueSpec>({ t: 'null' }),
  fc.constant<ValueSpec>({ t: 'sameRoom' }),
  fc.constant<ValueSpec>({ t: 'ownUid' }),
)

const fieldOpArb: fc.Arbitrary<FieldOp> = fc.oneof(
  fc.constant<FieldOp>({ op: 'keep' }),
  fc.constant<FieldOp>({ op: 'drop' }),
  valueArb.map<FieldOp>((v) => ({ op: 'set', v })),
)

const mutationArb = fc.record({
  userId: fieldOpArb,
  roomId: fieldOpArb,
  openedAt: fieldOpArb,
  expiresAt: fieldOpArb,
  extra: fc.option(
    fc.record({
      name: fc.constantFrom('extra', 'note', 'slot', 'isAdmin'),
      v: valueArb,
    }),
    { nil: undefined },
  ),
  write: fc.constantFrom('setDoc', 'updateDoc', 'batchSet', 'batchUpdate', 'deleteDoc', 'batchDelete'),
  slotN: fc.constantFrom<1 | 2>(1, 2),
})

describe('Feature: room-limit, Property 6: Slots are never deleted and unexpired slots are never updated', () => {
  it(
    'every client update or delete of an Active slot is denied and the stored slot is unchanged',
    async () => {
      let runId = 0
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 60, max: 23 * HOUR_S }),
          fc.array(mutationArb, { minLength: 1, maxLength: 4 }),
          async (ageSeconds, mutations) => {
            runId++
            await clearData()
            const admin = await adminDb()
            await seedUser(admin, 'userA')
            await seedSlot(admin, 'userA', 1, { ageSeconds, roomId: 'seed-room-1' })
            await seedSlot(admin, 'userA', 2, { ageSeconds, roomId: 'seed-room-2' })

            const before: Record<string, Record<string, unknown>> = {}
            for (const n of [1, 2]) {
              const snap = await getDoc(doc(admin, 'roomSlots', `userA_${n}`))
              before[n] = snap.data()!
            }
            const openedMs = (before[1].openedAt as Timestamp).toMillis()

            const resolve = (v: ValueSpec, n: number): unknown => {
              switch (v.t) {
                case 'ts': return Timestamp.fromMillis(openedMs + v.offsetMs)
                case 'server': return serverTimestamp()
                case 'str': return v.s
                case 'num': return v.n
                case 'bool': return v.b
                case 'null': return null
                case 'sameRoom': return `seed-room-${n}`
                case 'ownUid': return 'userA'
              }
            }

            const db = await userADb()
            for (let i = 0; i < mutations.length; i++) {
              const m = mutations[i]
              const n = m.slotN
              const ref = doc(db, 'roomSlots', `userA_${n}`)
              const full: Record<string, unknown> = {}
              const partial: Record<string, unknown> = {}
              for (const key of ['userId', 'roomId', 'openedAt', 'expiresAt'] as const) {
                const f = m[key]
                if (f.op === 'keep') {
                  full[key] = before[n][key]
                } else if (f.op === 'set') {
                  full[key] = resolve(f.v, n)
                  partial[key] = full[key]
                } else {
                  partial[key] = deleteField()
                }
              }
              if (m.extra) {
                full[m.extra.name] = resolve(m.extra.v, n)
                partial[m.extra.name] = full[m.extra.name]
              }
              // updateDoc needs at least one field to be a real write.
              if (Object.keys(partial).length === 0) partial.roomId = `seed-room-${n}`

              const newRoom = () =>
                createRoomBatch(db, {
                  uid: 'userA',
                  roomId: `prop6-room-${runId}-${i}`,
                  slotId: `userA_${n}`,
                  omitSlot: true,
                })

              switch (m.write) {
                case 'setDoc':
                  await assertFails(setDoc(ref, full))
                  break
                case 'updateDoc':
                  await assertFails(updateDoc(ref, partial))
                  break
                case 'batchSet': {
                  const b = newRoom()
                  b.set(ref, full)
                  await assertFails(b.commit())
                  break
                }
                case 'batchUpdate': {
                  const b = newRoom()
                  b.update(ref, partial)
                  await assertFails(b.commit())
                  break
                }
                case 'deleteDoc':
                  await assertFails(deleteDoc(ref))
                  break
                case 'batchDelete': {
                  const b = newRoom()
                  b.delete(ref)
                  await assertFails(b.commit())
                  break
                }
              }
            }

            for (const n of [1, 2]) {
              const snap = await getDoc(doc(admin, 'roomSlots', `userA_${n}`))
              expect(snap.exists()).toBe(true)
              expect(snap.data()).toEqual(before[n])
            }
          },
        ),
        { numRuns: 20 },
      )
    },
    120_000,
  )
})