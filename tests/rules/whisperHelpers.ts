import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore'
import type { Firestore, WriteBatch } from 'firebase/firestore'
import { adminDb } from './helpers.js'

const MIN_MS = 60 * 1000
const HOUR_MS = 60 * MIN_MS

/**
 * Ages in seconds, chosen to stay away from the exact boundaries because request.time cannot be
 * faked in the emulator. Pending invites are valid for 15 minutes, open threads last 1 hour.
 */
export const AGES = {
  pendingValidS: 14 * 60,
  pendingStaleS: 16 * 60,
  open30S: 30 * 60,
  open59S: 59 * 60,
  overS: 61 * 60,
} as const

export type Band = 'under_13' | '13_17' | '18_plus'
export type WhisperStatus = 'requested' | 'accepted' | 'declined' | 'ended'

type Overrides = Record<string, unknown>

/** An override value of undefined removes that key (the SDK rejects undefined values). */
function dropUndefined(data: Overrides): Overrides {
  for (const key of Object.keys(data)) {
    if (data[key] === undefined) delete data[key]
  }
  return data
}

/** The expiresAt hint a freshly written Whisper gets: 90 minutes from now. */
function freshExpiresAt(): Timestamp {
  return Timestamp.fromMillis(Date.now() + 90 * MIN_MS)
}

async function storedWhisperExpiresAt(whisperId: string): Promise<Timestamp> {
  const admin = await adminDb()
  const snap = await getDoc(doc(admin, 'whispers', whisperId))
  const value = snap.data()?.expiresAt
  if (!(value instanceof Timestamp)) {
    throw new Error(`whispers/${whisperId} has no expiresAt; seed it with seedWhisper first`)
  }
  return value
}

// ---------------------------------------------------------------- batches

export interface InviteOptions {
  inviterId: string
  inviteeId: string
  whisperId: string
  inviterSlot?: number                 // default 1
  slotId?: string                      // default `${inviterId}_${inviterSlot}`
  whisperOverrides?: Overrides         // merged over the valid Whisper data
  slotOverrides?: Overrides            // merged over the valid slot data
  omitSlot?: boolean                   // Whisper only, no slot write
  omitWhisper?: boolean                // slot only, no Whisper write
}

/**
 * Invite batch: the Whisper create plus the inviter's slot write.
 * The slot's expiresAt follows the Whisper's final expiresAt unless slotOverrides says otherwise.
 * The caller runs assertSucceeds(batch.commit()) or assertFails(batch.commit()).
 */
export function inviteBatch(db: Firestore, opts: InviteOptions): WriteBatch {
  const inviterSlot = opts.inviterSlot ?? 1

  const whisperData = dropUndefined({
    inviterId: opts.inviterId,
    inviteeId: opts.inviteeId,
    memberIds: [opts.inviterId, opts.inviteeId],
    status: 'requested',
    createdAt: serverTimestamp(),
    acceptedAt: null,
    endedBy: null,
    inviterSlot,
    inviteeSlot: null,
    expiresAt: freshExpiresAt(),
    ...opts.whisperOverrides,
  })

  const slotData = dropUndefined({
    userId: opts.inviterId,
    whisperId: opts.whisperId,
    openedAt: serverTimestamp(),
    expiresAt: whisperData.expiresAt,
    ...opts.slotOverrides,
  })

  const batch = writeBatch(db)
  if (!opts.omitWhisper) batch.set(doc(db, 'whispers', opts.whisperId), whisperData)
  if (!opts.omitSlot) {
    batch.set(doc(db, 'whisperSlots', opts.slotId ?? `${opts.inviterId}_${inviterSlot}`), slotData)
  }
  return batch
}

export interface AcceptOptions {
  inviteeId: string
  whisperId: string
  inviteeSlot?: number                 // default 1
  slotId?: string                      // default `${inviteeId}_${inviteeSlot}`
  expiresAt?: Timestamp                // default: read from the seeded Whisper through the admin context
  whisperOverrides?: Overrides         // merged over the valid update fields
  slotOverrides?: Overrides
  omitSlot?: boolean
}

/**
 * Accept batch: the Whisper update plus the invitee's slot write.
 * Async because the slot's expiresAt must equal the stored Whisper's, which it reads with the
 * admin context (unless `expiresAt` is passed).
 */
export async function acceptBatch(db: Firestore, opts: AcceptOptions): Promise<WriteBatch> {
  const inviteeSlot = opts.inviteeSlot ?? 1
  const expiresAt = opts.expiresAt ?? (await storedWhisperExpiresAt(opts.whisperId))

  const update = dropUndefined({
    status: 'accepted',
    acceptedAt: serverTimestamp(),
    inviteeSlot,
    ...opts.whisperOverrides,
  })

  const slotData = dropUndefined({
    userId: opts.inviteeId,
    whisperId: opts.whisperId,
    openedAt: serverTimestamp(),
    expiresAt,
    ...opts.slotOverrides,
  })

  const batch = writeBatch(db)
  batch.update(doc(db, 'whispers', opts.whisperId), update)
  if (!opts.omitSlot) {
    batch.set(doc(db, 'whisperSlots', opts.slotId ?? `${opts.inviteeId}_${inviteeSlot}`), slotData)
  }
  return batch
}

export interface MessageOptions {
  senderId: string
  whisperId: string
  messageId?: string                   // default 'msg1'
  body?: string                        // default 'hello'
  expiresAt?: Timestamp                // default: read from the seeded Whisper through the admin context
  messageOverrides?: Overrides
  rateLimitOverrides?: Overrides
  omitRateLimit?: boolean
}

/** Message batch: the message create plus the sender's rate limit write (create or update). */
export async function messageBatch(db: Firestore, opts: MessageOptions): Promise<WriteBatch> {
  const messageId = opts.messageId ?? 'msg1'
  const expiresAt = opts.expiresAt ?? (await storedWhisperExpiresAt(opts.whisperId))

  const messageData = dropUndefined({
    messageId,
    senderId: opts.senderId,
    body: opts.body ?? 'hello',
    sentAt: serverTimestamp(),
    whisperId: opts.whisperId,
    expiresAt,
    ...opts.messageOverrides,
  })

  const rateLimitData = dropUndefined({
    userId: opts.senderId,
    lastMessageAt: serverTimestamp(),
    expiresAt,
    ...opts.rateLimitOverrides,
  })

  const batch = writeBatch(db)
  batch.set(doc(db, 'whispers', opts.whisperId, 'messages', messageId), messageData)
  if (!opts.omitRateLimit) {
    batch.set(doc(db, 'whispers', opts.whisperId, 'rateLimits', opts.senderId), rateLimitData)
  }
  return batch
}

// ---------------------------------------------------------------- seeders (admin context)

/** Seed users/{uid}. Default: 18_plus, created 2 days ago so not in probation. */
export async function seedUser(
  admin: Firestore,
  uid: string,
  opts: { band?: Band; ageSeconds?: number } = {},
): Promise<void> {
  const ageMs = (opts.ageSeconds ?? 48 * 3600) * 1000
  await setDoc(doc(admin, 'users', uid), {
    createdAt: Timestamp.fromMillis(Date.now() - ageMs),
    ageBandLabel: opts.band ?? '18_plus',
  })
}

export interface SeedWhisperOptions {
  inviterId: string
  inviteeId: string
  status: WhisperStatus
  createdAgeS: number                  // seconds since createdAt
  acceptedAgeS?: number                // seconds since acceptedAt; required for accepted threads
  endedBy?: string | null
  inviterSlot?: number                 // default 1
  inviteeSlot?: number | null          // default 1 if accepted, else null
}

/**
 * Seed whispers/{id} with backdated times. expiresAt is createdAt + 90 minutes, as a fresh invite
 * would carry. Returns that expiresAt so a test can build matching slots.
 */
export async function seedWhisper(
  admin: Firestore,
  id: string,
  opts: SeedWhisperOptions,
): Promise<Timestamp> {
  const createdMs = Date.now() - opts.createdAgeS * 1000
  const expiresAt = Timestamp.fromMillis(createdMs + 90 * MIN_MS)
  const accepted = opts.acceptedAgeS !== undefined
  await setDoc(doc(admin, 'whispers', id), {
    inviterId: opts.inviterId,
    inviteeId: opts.inviteeId,
    memberIds: [opts.inviterId, opts.inviteeId],
    status: opts.status,
    createdAt: Timestamp.fromMillis(createdMs),
    acceptedAt: accepted ? Timestamp.fromMillis(Date.now() - (opts.acceptedAgeS as number) * 1000) : null,
    endedBy: opts.endedBy ?? null,
    inviterSlot: opts.inviterSlot ?? 1,
    inviteeSlot: opts.inviteeSlot !== undefined ? opts.inviteeSlot : accepted ? 1 : null,
    expiresAt,
  })
  return expiresAt
}

/** Seed whisperSlots/{uid}_{n} with a backdated openedAt. expiresAt is openedAt + 90 minutes unless given. */
export async function seedWhisperSlot(
  admin: Firestore,
  uid: string,
  n: 1 | 2 | 3,
  opts: { whisperId: string; ageSeconds: number; expiresAt?: Timestamp },
): Promise<void> {
  const openedMs = Date.now() - opts.ageSeconds * 1000
  await setDoc(doc(admin, 'whisperSlots', `${uid}_${n}`), {
    userId: uid,
    whisperId: opts.whisperId,
    openedAt: Timestamp.fromMillis(openedMs),
    expiresAt: opts.expiresAt ?? Timestamp.fromMillis(openedMs + 90 * MIN_MS),
  })
}

/** Seed users/{blocker}/blocked/{blocked}. */
export async function seedBlock(admin: Firestore, blocker: string, blocked: string): Promise<void> {
  await setDoc(doc(admin, 'users', blocker, 'blocked', blocked), {
    blockedId: blocked,
    blockedAt: Timestamp.fromMillis(Date.now() - HOUR_MS),
  })
}

/**
 * Seed whispers/{whisperId}/rateLimits/{uid}. The Whisper must already be seeded: the rate limit's
 * expiresAt must equal the Whisper's, because the rules require it to stay unchanged on update.
 */
export async function seedRateLimit(
  admin: Firestore,
  whisperId: string,
  uid: string,
  ageSeconds: number,
): Promise<void> {
  const expiresAt = await storedWhisperExpiresAt(whisperId)
  await setDoc(doc(admin, 'whispers', whisperId, 'rateLimits', uid), {
    userId: uid,
    lastMessageAt: Timestamp.fromMillis(Date.now() - ageSeconds * 1000),
    expiresAt,
  })
}
