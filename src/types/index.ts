import type { Timestamp } from 'firebase/firestore'

export const AGE_BANDS = ['under_13', '13_17', '18_plus'] as const
export type AgeBandLabel = (typeof AGE_BANDS)[number]

export const MATURITY_LABELS = ['all_ages', '13_plus', '18_plus'] as const
export type MaturityLabel = (typeof MATURITY_LABELS)[number]

export const ROOM_TYPES = ['live_room', 'open_topic'] as const
export type RoomType = (typeof ROOM_TYPES)[number]

// Must match the category list in firestore.rules.
export const CATEGORY_ALLOWLIST = [
  'film', 'sport', 'music', 'gaming', 'news',
  'science', 'food', 'travel', 'tech', 'other',
] as const
export type Category = (typeof CATEGORY_ALLOWLIST)[number]

// Must match the constants in firestore.rules.
export const CATEGORY_LABELS: Record<Category, string> = {
  film: 'Film',
  sport: 'Sport',
  music: 'Music',
  gaming: 'Gaming',
  news: 'News',
  science: 'Science',
  food: 'Food',
  travel: 'Travel',
  tech: 'Tech',
  other: 'Other',
}

export const MATURITY_DISPLAY: Record<MaturityLabel, string> = {
  all_ages: 'All ages',
  '13_plus': '13+',
  '18_plus': '18+',
}

export const ROOM_TYPE_DISPLAY: Record<RoomType, string> = {
  live_room: 'Live room',
  open_topic: 'Open topic',
}

export const PROBATION_DURATION_S = 3600
export const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000
// expiresAt is a TTL-cleanup field only. Rules require it to be 24-26 h after request.time.
export const ROOM_TTL_MS = 25 * 60 * 60 * 1000
export const MESSAGE_MAX_LENGTH = 280
export const MESSAGE_MIN_INTERVAL_S = 3

export const USERNAME_MIN = 3
export const USERNAME_MAX = 20

/** publicProfiles/{uid}: the only identity other people see. */
export interface PublicProfile {
  username: string
  avatarSeed: string
}

/** users/{uid}: private to the owner. Stores an age band, never a birth date. */
export interface UserDoc {
  createdAt: Timestamp
  ageBandLabel: AgeBandLabel
}

export interface Room {
  type: RoomType
  title: string
  maturityLabel: MaturityLabel
  categories: Category[]
  openedAt: Timestamp
  expiresAt: Timestamp
  createdBy: string
  postingParticipantCount: number
}

export interface Message {
  messageId: string
  senderId: string
  body: string
  sentAt: Timestamp
  roomId: string
  expiresAt: Timestamp
}

export interface Participant {
  userId: string
  firstMessageId: string
  firstMessageAt: Timestamp
  expiresAt: Timestamp
}

export interface RateLimit {
  userId: string
  lastMessageAt: Timestamp
  expiresAt: Timestamp
}

export type SortOrder = 'newest' | 'ending_soon' | 'busiest'

/** What the screens work with: a room document flattened to plain values. */
export interface RoomView {
  id: string
  type: RoomType
  title: string
  maturityLabel: MaturityLabel
  categories: Category[]
  openedAtMs: number
  postingParticipantCount: number
  createdBy: string
}

export interface MessageView {
  id: string
  senderId: string
  body: string
  sentAtMs: number
  /** True while the message is only stored on this device and has not reached the server. */
  pending: boolean
  /** Demo mode only: exists on this screen, never stored, never shown to anyone else. */
  simulated?: boolean
}
