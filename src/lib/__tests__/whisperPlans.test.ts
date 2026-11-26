import { Timestamp } from 'firebase/firestore'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  isServerTime,
  planAccept,
  planBlock,
  planCancel,
  planDecline,
  planEnd,
  planInvite,
  planMessage,
  planUnblock,
  SERVER_TIME,
  type Op,
  type Plan,
} from '../whisperPlans'
import { WHISPER_STATUSES, type SlotNumber } from '../whisperTypes'

// The field sets below are copied from firestore.rules, not from the plans.
const WHISPER_CREATE_KEYS = ['inviterId', 'inviteeId', 'memberIds', 'status', 'createdAt', 'acceptedAt', 'endedBy', 'inviterSlot', 'inviteeSlot', 'expiresAt']
const SLOT_KEYS = ['userId', 'whisperId', 'openedAt', 'expiresAt']
const ACCEPT_KEYS = ['status', 'acceptedAt', 'inviteeSlot']
const END_KEYS = ['status', 'endedBy']
const MESSAGE_KEYS = ['messageId', 'senderId', 'body', 'sentAt', 'whisperId', 'expiresAt']
const RATE_KEYS = ['userId', 'lastMessageAt', 'expiresAt']
const BLOCK_KEYS = ['blockedId', 'blockedAt']

const keys = (op: Op) => (op.kind === 'delete' ? [] : Object.keys(op.data).sort())
const sorted = (a: string[]) => [...a].sort()
const data = (op: Op) => {
  if (op.kind === 'delete') throw new Error('delete has no data')
  return op.data
}

const EXPIRES = Timestamp.fromMillis(1_800_000_000_000)
const id = fc.stringMatching(/^[A-Za-z0-9]{3,12}$/)
const slot = fc.constantFrom<SlotNumber>(1, 2, 3)

describe('plans: examples', () => {
  it('invite writes the Whisper and the inviter slot with exactly the rules fields', () => {
    const plan = planInvite({ uid: 'alice', inviteeId: 'bob', whisperId: 'w1', slot: 2, expiresAt: EXPIRES })
    expect(plan).toHaveLength(2)
    expect(plan[0].kind).toBe('set')
    expect(plan[0].path).toEqual(['whispers', 'w1'])
    expect(keys(plan[0])).toEqual(sorted(WHISPER_CREATE_KEYS))
    expect(data(plan[0])).toMatchObject({
      inviterId: 'alice',
      inviteeId: 'bob',
      memberIds: ['alice', 'bob'],
      status: 'requested',
      acceptedAt: null,
      endedBy: null,
      inviterSlot: 2,
      inviteeSlot: null,
    })
    expect(isServerTime(data(plan[0]).createdAt)).toBe(true)
    expect(plan[1].path).toEqual(['whisperSlots', 'alice_2'])
    expect(keys(plan[1])).toEqual(sorted(SLOT_KEYS))
    expect(data(plan[1])).toMatchObject({ userId: 'alice', whisperId: 'w1' })
  })

  it('accept updates three fields and writes the invitee slot with the Whisper expiresAt', () => {
    const plan = planAccept({ uid: 'bob', whisper: { id: 'w1', expiresAt: EXPIRES }, slot: 3 })
    expect(plan[0].kind).toBe('update')
    expect(plan[0].path).toEqual(['whispers', 'w1'])
    expect(keys(plan[0])).toEqual(sorted(ACCEPT_KEYS))
    expect(data(plan[0])).toMatchObject({ status: 'accepted', inviteeSlot: 3 })
    expect(isServerTime(data(plan[0]).acceptedAt)).toBe(true)
    expect(plan[1].path).toEqual(['whisperSlots', 'bob_3'])
    expect(data(plan[1]).expiresAt).toBe(EXPIRES)
  })

  it('decline sets only status; cancel and end set status and endedBy', () => {
    expect(data(planDecline('w1')[0])).toEqual({ status: 'declined' })
    for (const plan of [planCancel({ uid: 'alice', whisperId: 'w1' }), planEnd({ uid: 'bob', whisperId: 'w1' })]) {
      expect(plan).toHaveLength(1)
      expect(plan[0].kind).toBe('update')
      expect(keys(plan[0])).toEqual(sorted(END_KEYS))
      expect(data(plan[0]).status).toBe('ended')
    }
    expect(data(planCancel({ uid: 'alice', whisperId: 'w1' })[0]).endedBy).toBe('alice')
  })

  it('block writes the entry; unblock deletes it', () => {
    const block = planBlock({ uid: 'bob', otherId: 'alice', whisper: null })
    expect(block).toHaveLength(1)
    expect(block[0].path).toEqual(['users', 'bob', 'blocked', 'alice'])
    expect(keys(block[0])).toEqual(sorted(BLOCK_KEYS))
    expect(data(block[0]).blockedId).toBe('alice')
    expect(planUnblock({ uid: 'bob', otherId: 'alice' })).toEqual([{ kind: 'delete', path: ['users', 'bob', 'blocked', 'alice'] }])
  })

  it('message writes the message and the rate limit', () => {
    const plan = planMessage({ uid: 'bob', whisper: { id: 'w1', expiresAt: EXPIRES }, messageId: 'm1', body: 'hi' })
    expect(plan).toHaveLength(2)
    expect(plan[0].path).toEqual(['whispers', 'w1', 'messages', 'm1'])
    expect(keys(plan[0])).toEqual(sorted(MESSAGE_KEYS))
    expect(data(plan[0])).toMatchObject({ messageId: 'm1', senderId: 'bob', body: 'hi', whisperId: 'w1' })
    expect(plan[1].path).toEqual(['whispers', 'w1', 'rateLimits', 'bob'])
    expect(keys(plan[1])).toEqual(sorted(RATE_KEYS))
  })

  it('SERVER_TIME is a single shared marker', () => {
    expect(isServerTime(SERVER_TIME)).toBe(true)
    expect(isServerTime({ __serverTime: true })).toBe(false)
  })
})

describe('plans: properties', () => {
  it('invite: exact fields, slot named by the Whisper, same expiresAt, slot id is the person and the slot number', () => {
    fc.assert(
      fc.property(id, id, id, slot, (uid, invitee, wid, n) => {
        fc.pre(uid !== invitee)
        const [w, s] = planInvite({ uid, inviteeId: invitee, whisperId: wid, slot: n, expiresAt: EXPIRES })
        expect(keys(w)).toEqual(sorted(WHISPER_CREATE_KEYS))
        expect(keys(s)).toEqual(sorted(SLOT_KEYS))
        expect(data(w).memberIds).toEqual([uid, invitee])
        expect(data(w).inviterSlot).toBe(n)
        expect(s.path).toEqual(['whisperSlots', `${uid}_${n}`])
        expect(data(s).whisperId).toBe(wid)
        expect(w.path).toEqual(['whispers', wid])
        expect(data(s).expiresAt).toBe(data(w).expiresAt)
      }),
    )
  })

  it('accept: exact fields, slot named by the update, same expiresAt as the Whisper', () => {
    fc.assert(
      fc.property(id, id, slot, (uid, wid, n) => {
        const [u, s] = planAccept({ uid, whisper: { id: wid, expiresAt: EXPIRES }, slot: n })
        expect(u.kind).toBe('update')
        expect(keys(u)).toEqual(sorted(ACCEPT_KEYS))
        expect(data(u).inviteeSlot).toBe(n)
        expect(s.path).toEqual(['whisperSlots', `${uid}_${n}`])
        expect(data(s).whisperId).toBe(wid)
        expect(data(s).expiresAt).toBe(EXPIRES)
      }),
    )
  })

  it('a message plan always has the rate-limit write, with the same expiresAt', () => {
    fc.assert(
      fc.property(id, id, id, fc.string({ minLength: 1, maxLength: 280 }), (uid, wid, mid, body) => {
        const plan = planMessage({ uid, whisper: { id: wid, expiresAt: EXPIRES }, messageId: mid, body })
        expect(plan).toHaveLength(2)
        expect(plan[1].path).toEqual(['whispers', wid, 'rateLimits', uid])
        expect(data(plan[0]).expiresAt).toBe(data(plan[1]).expiresAt)
        expect(data(plan[0]).senderId).toBe(uid)
      }),
    )
  })

  it('block: always the block entry, plus the one update the rules allow, and none for a finished whisper', () => {
    fc.assert(
      fc.property(fc.constantFrom(...WHISPER_STATUSES), fc.constantFrom('inviter', 'invitee'), (status, role) => {
        const whisper = { id: 'w1', status, inviterId: 'alice', inviteeId: 'bob' }
        const uid = role === 'inviter' ? 'alice' : 'bob'
        const other = role === 'inviter' ? 'bob' : 'alice'
        const plan = planBlock({ uid, otherId: other, whisper })
        const blocks = plan.filter((o) => o.path[0] === 'users')
        const updates = plan.filter((o) => o.path[0] === 'whispers')
        expect(blocks).toHaveLength(1)
        expect(blocks[0].path).toEqual(['users', uid, 'blocked', other])
        if (status === 'declined' || status === 'ended') expect(updates).toHaveLength(0)
        else {
          expect(updates).toHaveLength(1)
          const u = updates[0]
          if (status === 'requested' && role === 'invitee') expect(keys(u)).toEqual(['status']) // decline
          else expect(keys(u)).toEqual(sorted(END_KEYS)) // cancel or end
        }
        expect(plan.every((o) => o.kind !== 'delete')).toBe(true)
      }),
    )
  })

  it('no plan ever deletes or writes a slot except in an invite or accept, and only unblock deletes anything', () => {
    fc.assert(
      fc.property(id, id, id, slot, (uid, other, wid, n) => {
        fc.pre(uid !== other)
        const plans: Plan[] = [
          planDecline(wid),
          planCancel({ uid, whisperId: wid }),
          planEnd({ uid, whisperId: wid }),
          planBlock({ uid, otherId: other, whisper: { id: wid, status: 'accepted', inviterId: uid, inviteeId: other } }),
          planMessage({ uid, whisper: { id: wid, expiresAt: EXPIRES }, messageId: 'm', body: 'x' }),
        ]
        for (const p of plans) for (const op of p) {
          expect(op.kind).not.toBe('delete')
          expect(op.path[0]).not.toBe('whisperSlots')
        }
        const withSlots: Plan[] = [
          planInvite({ uid, inviteeId: other, whisperId: wid, slot: n, expiresAt: EXPIRES }),
          planAccept({ uid, whisper: { id: wid, expiresAt: EXPIRES }, slot: n }),
        ]
        for (const p of withSlots) {
          expect(p.filter((o) => o.path[0] === 'whisperSlots')).toHaveLength(1)
          expect(p.every((o) => o.kind !== 'delete')).toBe(true)
        }
      }),
    )
  })
})
