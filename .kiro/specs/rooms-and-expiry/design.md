# Design Document

## Overview

Rooms-and-expiry implements the core live-chat lifecycle for Volubly using Firebase Auth, Firestore, and App Check — with **no Cloud Functions**. All server-side enforcement is in Firestore Security Rules. Rooms live for exactly 24 hours, measured from `openedAt` (a server timestamp equal to `request.time` at creation). `expiresAt` is stored only as a Firestore TTL field for physical cleanup and plays no enforcement role.

## Architecture

```
Browser (React + Vite)
  ├── Firebase Auth (UID)
  ├── Firestore SDK
  │     ├── publicProfiles/{userId}        username, avatarSeed
  │     ├── users/{userId}                 createdAt, ageBandLabel (private)
  │     ├── rooms/{roomId}                 room document
  │     │     ├── messages/{messageId}     per-message document
  │     │     ├── participants/{userId}    first-send record
  │     │     └── rateLimits/{userId}      rate-limit sentinel
  │     └── [Firestore TTL deletes all docs when expiresAt passes]
  └── App Check (token on every request)
```

No Cloud Functions. No server processes. Security Rules are the enforcement layer.

---

## Data Models

### `publicProfiles/{userId}`

| Field | Type | Constraints |
|---|---|---|
| `username` | string | 1–30 chars |
| `avatarSeed` | string | non-empty; used to deterministically generate an avatar image client-side |

Security Rules: any authenticated user may **read**; only the document owner may **create or update**; **delete denied**.

---

### `users/{userId}`

| Field | Type | Constraints |
|---|---|---|
| `createdAt` | timestamp | `== request.time` on create; immutable |
| `ageBandLabel` | string | `under_13` \| `13_17` \| `18_plus`; immutable |

Security Rules: owner-only **read**, **create**, **update**; **delete denied**. On create: `createdAt == request.time`. On update: `createdAt` and `ageBandLabel` are immutable; field set is locked to `['createdAt', 'ageBandLabel']`.

---

### `rooms/{roomId}`

| Field | Type | Constraints |
|---|---|---|
| `type` | string | `live_room` \| `open_topic`; immutable |
| `title` | string | 1–120 chars |
| `maturityLabel` | string | `all_ages` \| `13_plus` \| `18_plus`; immutable |
| `categories` | array\<string\> | 1–3 values from `CATEGORY_ALLOWLIST`; immutable |
| `openedAt` | timestamp | `== request.time` on create; immutable |
| `expiresAt` | timestamp | `request.time + 86 400 s..93 600 s` on create; immutable; TTL field only |
| `createdBy` | string | `== request.auth.uid` on create; immutable |
| `postingParticipantCount` | number | `== 0` on create; only allowed update: `+1`, tied to participant doc creation in same batch |

**Allowed field set on create:** `type`, `title`, `maturityLabel`, `categories`, `openedAt`, `expiresAt`, `createdBy`, `postingParticipantCount`

**Allowed field set on update:** `postingParticipantCount` only (and only `+1`)

```typescript
// Shared constant — single source of truth
export const CATEGORY_ALLOWLIST = [
  'film', 'sport', 'music', 'gaming', 'news',
  'science', 'food', 'travel', 'tech', 'other',
] as const;
export type Category = typeof CATEGORY_ALLOWLIST[number];
```

---

### `rooms/{roomId}/messages/{messageId}`

| Field | Type | Constraints |
|---|---|---|
| `messageId` | string | UUID v4; equals document ID |
| `senderId` | string | `== request.auth.uid` |
| `body` | string | plain text, 1–280 chars |
| `sentAt` | timestamp | `== request.time` (server timestamp) |
| `roomId` | string | `== roomId` path segment |
| `expiresAt` | timestamp | `== room.expiresAt`; Firestore TTL |

**Allowed field set:** `messageId`, `senderId`, `body`, `sentAt`, `roomId`, `expiresAt`

---

### `rooms/{roomId}/participants/{userId}`

| Field | Type | Constraints |
|---|---|---|
| `userId` | string | `== request.auth.uid`; equals document ID |
| `firstMessageId` | string | `== messageId` of the first message; must equal the document ID of a message being created in the same batch (`existsAfter` enforced) |
| `firstMessageAt` | timestamp | `== request.time` (server timestamp) |
| `expiresAt` | timestamp | `== room.expiresAt`; Firestore TTL |

**Create-only** (Security Rules deny updates and deletes).

**Allowed field set:** `userId`, `firstMessageId`, `firstMessageAt`, `expiresAt`

---

### `rooms/{roomId}/rateLimits/{userId}`

| Field | Type | Constraints |
|---|---|---|
| `userId` | string | `== request.auth.uid`; equals document ID |
| `lastMessageAt` | timestamp | `== request.time` on every write |
| `expiresAt` | timestamp | `== room.expiresAt`; Firestore TTL |

**Allowed field set:** `userId`, `lastMessageAt`, `expiresAt`

---

## Security Rules Design

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ── helpers ──────────────────────────────────────────────────────────

    function isAuthed() {
      return request.auth != null;
    }

    function userDoc() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }

    function ageBand() {
      return userDoc().ageBandLabel;
    }

    function roomIsOpen(roomData) {
      return request.time < roomData.openedAt + duration.value(86400, 's');
    }

    function isInProbation() {
      return request.time < userDoc().createdAt + duration.value(3600, 's');
      // PROBATION_DURATION = 3600 s (1 hour). Adjust this constant to change the window.
    }

    function hasNoUrl(text) {
      // (?is): case-insensitive + dot-matches-newline (handles multi-line bodies)
      return !text.matches('(?is).*(https?://|www\\.).*');
    }

    function ageCanReadRoom(maturity) {
      // Mirrors the client-side maturityFilter() exactly.
      // under_13 : only all_ages
      // 13_17    : all_ages or 13_plus
      // 18_plus  : any
      let band = ageBand();
      return band == '18_plus'
          || (band == '13_17'   && maturity in ['all_ages', '13_plus'])
          || (band == 'under_13' && maturity in ['all_ages']);
    }

    // ── publicProfiles ───────────────────────────────────────────────────

    match /publicProfiles/{userId} {
      allow read:   if isAuthed();
      allow create: if isAuthed()
        && request.auth.uid == userId
        && request.resource.data.keys().hasOnly(['username', 'avatarSeed'])
        && request.resource.data.username is string
        && request.resource.data.username.size() >= 1
        && request.resource.data.username.size() <= 30
        && request.resource.data.avatarSeed is string
        && request.resource.data.avatarSeed.size() >= 1;
      allow update: if isAuthed()
        && request.auth.uid == userId
        && request.resource.data.keys().hasOnly(['username', 'avatarSeed'])
        && request.resource.data.username is string
        && request.resource.data.username.size() >= 1
        && request.resource.data.username.size() <= 30
        && request.resource.data.avatarSeed is string
        && request.resource.data.avatarSeed.size() >= 1;
      allow delete: if false;
    }

    // ── users (private) ──────────────────────────────────────────────────

    match /users/{userId} {
      allow read:   if isAuthed() && request.auth.uid == userId;
      allow create: if isAuthed()
        && request.auth.uid == userId
        && request.resource.data.createdAt == request.time
        && request.resource.data.ageBandLabel in ['under_13', '13_17', '18_plus']
        && request.resource.data.keys().hasOnly(['createdAt', 'ageBandLabel']);
      allow update: if isAuthed()
        && request.auth.uid == userId
        // field set locked — no new fields can be added
        && request.resource.data.keys().hasOnly(['createdAt', 'ageBandLabel'])
        // createdAt and ageBandLabel are immutable
        && request.resource.data.createdAt    == resource.data.createdAt
        && request.resource.data.ageBandLabel == resource.data.ageBandLabel;
      allow delete: if false;
    }

    // ── rooms ────────────────────────────────────────────────────────────

    match /rooms/{roomId} {

      allow read: if isAuthed() && ageCanReadRoom(resource.data.maturityLabel);

      allow create: if isAuthed()
        && ageCanReadRoom(request.resource.data.maturityLabel)
        // openedAt must equal request.time (server-enforced)
        && request.resource.data.openedAt == request.time
        // expiresAt: 24–26 h after request.time, TTL range only
        && request.resource.data.expiresAt >= request.time + duration.value(86400, 's')
        && request.resource.data.expiresAt <= request.time + duration.value(93600, 's')
        // createdBy must be the caller
        && request.resource.data.createdBy == request.auth.uid
        // postingParticipantCount starts at 0
        && request.resource.data.postingParticipantCount == 0
        // allowed field set only
        && request.resource.data.keys().hasOnly([
             'type', 'title', 'maturityLabel', 'categories',
             'openedAt', 'expiresAt', 'createdBy', 'postingParticipantCount'
           ])
        // type allowlist
        && request.resource.data.type in ['live_room', 'open_topic']
        // maturityLabel allowlist
        && request.resource.data.maturityLabel in ['all_ages', '13_plus', '18_plus']
        // title length
        && request.resource.data.title is string
        && request.resource.data.title.size() >= 1
        && request.resource.data.title.size() <= 120
        // categories: 1–3 entries from allowlist
        && request.resource.data.categories.size() >= 1
        && request.resource.data.categories.size() <= 3
        && request.resource.data.categories.hasOnly([
             'film', 'sport', 'music', 'gaming', 'news',
             'science', 'food', 'travel', 'tech', 'other'
           ]);

      allow update: if isAuthed()
        // room must still be open
        && roomIsOpen(resource.data)
        // only postingParticipantCount may change, and only by exactly +1
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['postingParticipantCount'])
        && request.resource.data.postingParticipantCount == resource.data.postingParticipantCount + 1
        // the participant document for this user must NOT already exist (pre-write)
        // and MUST exist after the batch (existsAfter confirms the batch includes it)
        && !exists(/databases/$(database)/documents/rooms/$(roomId)/participants/$(request.auth.uid))
        && existsAfter(/databases/$(database)/documents/rooms/$(roomId)/participants/$(request.auth.uid))
        // immutable fields unchanged
        && request.resource.data.type         == resource.data.type
        && request.resource.data.maturityLabel == resource.data.maturityLabel
        && request.resource.data.openedAt      == resource.data.openedAt
        && request.resource.data.expiresAt     == resource.data.expiresAt
        && request.resource.data.createdBy     == resource.data.createdBy;

      allow delete: if false;

      // ── messages ───────────────────────────────────────────────────────
      match /messages/{messageId} {

        allow read: if isAuthed()
          && ageCanReadRoom(get(/databases/$(database)/documents/rooms/$(roomId)).data.maturityLabel)
          && roomIsOpen(get(/databases/$(database)/documents/rooms/$(roomId)).data);

        allow create: if isAuthed()
          && ageCanReadRoom(get(/databases/$(database)/documents/rooms/$(roomId)).data.maturityLabel)
          && roomIsOpen(get(/databases/$(database)/documents/rooms/$(roomId)).data)
          // senderId must equal the authenticated user
          && request.resource.data.senderId == request.auth.uid
          // field allowlist
          && request.resource.data.keys().hasOnly([
               'messageId', 'senderId', 'body', 'sentAt', 'roomId', 'expiresAt'
             ])
          // field type and value constraints
          && request.resource.data.messageId == messageId
          && request.resource.data.body is string
          && request.resource.data.body.size() >= 1
          && request.resource.data.body.size() <= 280
          && request.resource.data.sentAt    == request.time
          && request.resource.data.roomId    == roomId
          && request.resource.data.expiresAt == get(/databases/$(database)/documents/rooms/$(roomId)).data.expiresAt
          // rate limit:
          //   getAfter confirms rateLimits doc will have lastMessageAt == request.time in this batch
          //   then either no prior rateLimits doc exists, or the prior lastMessageAt is > 3 s ago
          && getAfter(/databases/$(database)/documents/rooms/$(roomId)/rateLimits/$(request.auth.uid))
               .data.lastMessageAt == request.time
          && (!exists(/databases/$(database)/documents/rooms/$(roomId)/rateLimits/$(request.auth.uid))
              || get(/databases/$(database)/documents/rooms/$(roomId)/rateLimits/$(request.auth.uid))
                   .data.lastMessageAt < request.time - duration.value(3, 's'))
          // probation URL block — (?is): case-insensitive, dot matches newline
          && (!isInProbation() || hasNoUrl(request.resource.data.body));

        allow update: if false;
        allow delete: if false;
      }

      // ── participants ───────────────────────────────────────────────────
      match /participants/{userId} {

        allow read: if isAuthed();

        allow create: if isAuthed()
          && request.auth.uid == userId
          && ageCanReadRoom(get(/databases/$(database)/documents/rooms/$(roomId)).data.maturityLabel)
          && roomIsOpen(get(/databases/$(database)/documents/rooms/$(roomId)).data)
          // field allowlist and value constraints
          && request.resource.data.keys().hasOnly(['userId', 'firstMessageId', 'firstMessageAt', 'expiresAt'])
          && request.resource.data.userId          == request.auth.uid
          && request.resource.data.firstMessageAt  == request.time
          && request.resource.data.expiresAt       == get(/databases/$(database)/documents/rooms/$(roomId)).data.expiresAt
          // create-only: document must not already exist
          && !exists(/databases/$(database)/documents/rooms/$(roomId)/participants/$(userId))
          // firstMessageId must equal the ID of a message being created in this same batch
          && existsAfter(/databases/$(database)/documents/rooms/$(roomId)/messages/$(request.resource.data.firstMessageId));

        allow update: if false;
        allow delete: if false;
      }

      // ── rateLimits ─────────────────────────────────────────────────────
      match /rateLimits/{userId} {

        allow read: if isAuthed() && request.auth.uid == userId;

        allow create: if isAuthed()
          && request.auth.uid == userId
          && roomIsOpen(get(/databases/$(database)/documents/rooms/$(roomId)).data)
          && request.resource.data.keys().hasOnly(['userId', 'lastMessageAt', 'expiresAt'])
          && request.resource.data.userId         == request.auth.uid
          && request.resource.data.lastMessageAt  == request.time
          && request.resource.data.expiresAt      == get(/databases/$(database)/documents/rooms/$(roomId)).data.expiresAt;

        allow update: if isAuthed()
          && request.auth.uid == userId
          && roomIsOpen(get(/databases/$(database)/documents/rooms/$(roomId)).data)
          && request.resource.data.keys().hasOnly(['userId', 'lastMessageAt', 'expiresAt'])
          && request.resource.data.userId         == resource.data.userId
          && request.resource.data.lastMessageAt  == request.time
          && request.resource.data.expiresAt      == resource.data.expiresAt;

        allow delete: if false;
      }
    }
  }
}
```

### Rate-limit rule explanation

The rate-limit check in the message `create` rule uses two Firestore functions in sequence:

1. **`getAfter(rateLimitsRef).data.lastMessageAt == request.time`** — asserts that the rateLimits document, as it will appear *after* the batch commits, has `lastMessageAt` set to `request.time`. This requires the batch to include a rateLimits write; without it the rule fails, so an accidental message-only write is rejected.

2. **`!exists(rateLimitsRef) || get(rateLimitsRef).data.lastMessageAt < request.time - 3s`** — before the batch, either no rateLimits doc exists (first message ever) or the existing `lastMessageAt` is more than 3 seconds ago.

Together these ensure: (a) the batch always updates the sentinel, and (b) the previous send was at least 3 seconds ago.

**Race condition:** Two concurrent sends from the same client can both pass the `get()` check before either write commits. This is an accepted trade-off of a no-Cloud-Functions architecture. The `messageId` idempotency guarantee prevents true message duplication even if both batches succeed.

### Participant-count guard

The room `update` rule ties the `postingParticipantCount + 1` increment to the creation of the participant document in the same batch:

- **`!exists(participantRef)`** — the participant doc must not already exist before the batch.
- **`existsAfter(participantRef)`** — the participant doc must exist after the batch, confirming it was created in this same write.

The participant `create` rule independently enforces that `firstMessageId` refers to a genuinely new message owned by the caller, using three conditions:

- **`!exists(messages/$(firstMessageId))`** — the message must not exist before the batch, preventing reuse of a pre-existing message as a `firstMessageId`.
- **`existsAfter(messages/$(firstMessageId))`** — the message must be created in the same batch.
- **`getAfter(messages/$(firstMessageId)).data.senderId == request.auth.uid`** — the message being created must belong to the caller, not another user.

---

## Posting-Participant Count

### Subcollection approach (no Cloud Functions)

```
rooms/{roomId}/participants/{userId}   (create-only, firstMessageId links to first message)
rooms/{roomId}                         postingParticipantCount (increment by client)
```

Both writes happen in the same batch. The room update rule enforces the linkage via `exists`/`existsAfter`. The participant rule independently confirms the message exists via `existsAfter` on `firstMessageId`.

### Client pre-checks

Before composing the batch, the client performs lightweight pre-checks to surface user-facing errors immediately without a round-trip:

```typescript
function preCheckSend(room: Room, uid: string, body: string, lastSentAt: Date | null): void {
  // 1. Expiry check
  if (Date.now() >= room.openedAt.toMillis() + 86_400_000) {
    throw new AppError('ROOM_EXPIRED', 'This room has ended.');
  }
  // 2. Rate-limit check (client-side clock; rules are authoritative)
  if (lastSentAt && Date.now() - lastSentAt.getTime() < 3_000) {
    throw new AppError('RATE_LIMITED', 'Please wait a moment before sending again.');
  }
  // 3. Probation URL check
  if (isUserInProbation(uid) && /(?:https?:\/\/|www\.)/i.test(body)) {
    throw new AppError('PROBATION_URL', 'You cannot include links during your first hour.');
  }
}
```

Pre-checks use the client clock and are advisory only. Security Rules remain the authoritative enforcement layer.

### First-message batch

```typescript
async function sendFirstMessage(roomId: string, uid: string, message: MessageData, roomExpiresAt: Timestamp) {
  const participantRef = doc(db, `rooms/${roomId}/participants/${uid}`);

  // Guard: if participant doc already exists, skip to subsequent-message path
  const participantSnap = await getDoc(participantRef);
  if (participantSnap.exists()) {
    return sendSubsequentMessage(roomId, uid, message, roomExpiresAt);
  }

  const batch        = writeBatch(db);
  const roomRef      = doc(db, `rooms/${roomId}`);
  const messageRef   = doc(db, `rooms/${roomId}/messages/${message.messageId}`);
  const rateLimitRef = doc(db, `rooms/${roomId}/rateLimits/${uid}`);

  batch.set(participantRef, {
    userId:          uid,
    firstMessageId:  message.messageId,   // links to message in same batch
    firstMessageAt:  serverTimestamp(),
    expiresAt:       roomExpiresAt,
  });
  batch.update(roomRef, {
    postingParticipantCount: increment(1),
  });
  batch.set(messageRef, {
    messageId:  message.messageId,
    senderId:   uid,
    body:       message.body,
    sentAt:     serverTimestamp(),
    roomId:     roomId,
    expiresAt:  roomExpiresAt,
  });
  batch.set(rateLimitRef, {
    userId:        uid,
    lastMessageAt: serverTimestamp(),
    expiresAt:     roomExpiresAt,
  }, { merge: false });

  try {
    await batch.commit();
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      return handlePermissionDenied(roomId, uid, message);
    }
    throw err;
  }
}
```

### Subsequent-message send

```typescript
async function sendSubsequentMessage(roomId: string, uid: string, message: MessageData, roomExpiresAt: Timestamp) {
  const batch        = writeBatch(db);
  const messageRef   = doc(db, `rooms/${roomId}/messages/${message.messageId}`);
  const rateLimitRef = doc(db, `rooms/${roomId}/rateLimits/${uid}`);

  batch.set(messageRef, {
    messageId:  message.messageId,
    senderId:   uid,
    body:       message.body,
    sentAt:     serverTimestamp(),
    roomId:     roomId,
    expiresAt:  roomExpiresAt,
  });
  batch.set(rateLimitRef, {
    userId:        uid,
    lastMessageAt: serverTimestamp(),
    expiresAt:     roomExpiresAt,
  }, { merge: false });

  try {
    await batch.commit();
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      return handlePermissionDenied(roomId, uid, message);
    }
    throw err;
  }
}
```

### Permission-denied recovery

When a message or batch write receives `permission-denied`, the client reads back the message document to disambiguate a spurious rules evaluation from a genuine block:

```typescript
async function handlePermissionDenied(roomId: string, uid: string, message: MessageData) {
  const messageRef = doc(db, `rooms/${roomId}/messages/${message.messageId}`);
  const snap       = await getDoc(messageRef);

  if (snap.exists() && snap.data()?.senderId === uid) {
    // Message was written before the permission-denied fired — treat as success.
    return;
  }
  // Genuine block: surface to the user.
  throw new Error('MESSAGE_BLOCKED');
}
```

---

## Idempotency and Retry Handling

```
Client pre-checks (expiry / rate-limit / probation-URL)
         │
         ├── fails → surface error immediately, do not send
         │
         ▼
   batch.commit() — message + rateLimits (+ participant + room update if first send)
         │
   ┌─────┴─────────────────────────────────────┐
   │ success                                    │ error
   ▼                                            ▼
 Done                     ┌──────────────────────┴──────────────┐
                          │                                      │
                  permission-denied                        network error
                          │                                      │
                          ▼                                      ▼
                  read message doc                      retry with same
                  back from Firestore                   messageId (safe)
                          │
                ┌─────────┴─────────┐
                │ exists + senderId  │ not found or
                │ == uid             │ wrong sender
                ▼                   ▼
           treat as success   surface error to user
```

The UI optimistic update is keyed on `messageId`. When the real-time listener delivers the same `messageId`, it replaces the optimistic entry in place — no duplicate rendering.

---

## Discovery Queries per Account_Age_Label

The client selects the Firestore query filter based on the authenticated user's `ageBandLabel`. The filter values mirror the `ageCanReadRoom()` Security Rules function exactly.

```typescript
const EXPIRY_WINDOW_MS = 86_400_000; // 24 h in ms
const DISCOVERY_LIMIT  = 100;

function maturityFilter(ageBand: AgeBandLabel): QueryConstraint | null {
  switch (ageBand) {
    case 'under_13':
      // matches ageCanReadRoom: maturity in ['all_ages']
      return where('maturityLabel', '==', 'all_ages');
    case '13_17':
      // matches ageCanReadRoom: maturity in ['all_ages', '13_plus']
      return where('maturityLabel', 'in', ['all_ages', '13_plus']);
    case '18_plus':
      // matches ageCanReadRoom: band == '18_plus' (no restriction)
      return null;
  }
}

function buildDiscoveryQuery(
  ageBand: AgeBandLabel,
  sortOrder: 'newest' | 'ending_soon' | 'busiest',
): Query {
  const cutoff  = Timestamp.fromMillis(Date.now() - EXPIRY_WINDOW_MS);
  const maturity = maturityFilter(ageBand);

  const constraints: QueryConstraint[] = [
    where('openedAt', '>', cutoff),
    limit(DISCOVERY_LIMIT),
    ...(maturity ? [maturity] : []),
  ];

  if (sortOrder === 'newest') {
    // composite index: maturityLabel ASC + openedAt DESC  (or openedAt DESC alone for 18_plus)
    constraints.push(orderBy('openedAt', 'desc'));
  } else if (sortOrder === 'ending_soon') {
    // composite index: maturityLabel ASC + openedAt ASC  (or openedAt ASC alone for 18_plus)
    constraints.push(orderBy('openedAt', 'asc'));
  } else {
    // busiest: fetch newest-first so the most-recently-active rooms are retrieved
    // when there are more than DISCOVERY_LIMIT rooms; sort client-side by count
    constraints.push(orderBy('openedAt', 'desc'));
  }

  return query(collection(db, 'rooms'), ...constraints);
}
```

**Defence-in-depth:** The `ageCanReadRoom()` Security Rules function enforces the same age matrix independently. A client-side query filter bypass is caught at the read level.

### Composite indexes

Defined in `firestore.indexes.json` (committed to the repository):

```json
{
  "indexes": [
    {
      "collectionGroup": "rooms",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "maturityLabel", "order": "ASCENDING" },
        { "fieldPath": "openedAt",      "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "rooms",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "maturityLabel", "order": "ASCENDING" },
        { "fieldPath": "openedAt",      "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

| Query | Index used |
|---|---|
| `newest` for `under_13` / `13_17` (maturityLabel filter + openedAt DESC) | `maturityLabel ASC, openedAt DESC` |
| `ending_soon` for `under_13` / `13_17` (maturityLabel filter + openedAt ASC) | `maturityLabel ASC, openedAt ASC` |
| `busiest` for `under_13` / `13_17` (maturityLabel filter + openedAt DESC) | `maturityLabel ASC, openedAt DESC` |
| `newest` / `ending_soon` / `busiest` for `18_plus` (openedAt only) | auto single-field index |

### "Your picks" / "Also live" split

```typescript
function splitAndSort(
  rooms: Room[],
  userCategories: string[],
  sortOrder: 'newest' | 'ending_soon' | 'busiest',
): { yourPicks: Room[]; alsoLive: Room[] } {
  // For busiest: sort client-side by postingParticipantCount desc
  const sorted = sortOrder === 'busiest'
    ? [...rooms].sort((a, b) => b.postingParticipantCount - a.postingParticipantCount)
    : rooms; // newest and ending_soon arrive pre-sorted from Firestore

  const yourPicks = sorted.filter(r => r.categories.some(c => userCategories.includes(c)));
  const alsoLive  = sorted.filter(r => !r.categories.some(c => userCategories.includes(c)));
  return { yourPicks, alsoLive };
}
```

---

## Reason_Label Computation

```typescript
function reasonLabel(room: Room, now: Date): string {
  const ageMs       = now.getTime() - room.openedAt.toMillis();
  const remainingMs = room.openedAt.toMillis() + EXPIRY_WINDOW_MS - now.getTime();

  if (ageMs < 300_000) return 'New room';           // < 5 min old
  if (remainingMs < 7_200_000) {                     // < 2 h remaining
    const h = Math.ceil(remainingMs / 3_600_000);
    return `Ending in ${h} h`;
  }
  const openedToday =
    new Date(room.openedAt.toMillis()).toDateString() === now.toDateString();
  if (openedToday) return 'Opened today';
  return 'Open now';
}
```

Labels "Trending now", "Hot", "Popular", "Active", and "Active today" are explicitly not used.

---

## Components and Interfaces

```
App
└── DiscoveryPage
      ├── SortOrderTabs             (newest | ending_soon | busiest)
      ├── RoomSection               ("Your picks")
      │     └── RoomCard[]
      │           ├── RoomTitle
      │           ├── MaturityBadge
      │           ├── ReasonLabel
      │           ├── PostingParticipantCount
      │           └── ExpiryCountdown       (derived from openedAt)
      └── RoomSection               ("Also live")
            └── RoomCard[]

RoomPage
  ├── RoomHeader                    (title, expiry countdown, participant count)
  ├── MessageList
  │     └── MessageItem[]           (username from publicProfiles, avatar from avatarSeed)
  └── MessageComposer
        ├── TextArea                (1–280 chars, plain text)
        └── SendButton

CreateRoomSheet
  ├── TypeSelector                  (live_room | open_topic)
  ├── TitleInput
  ├── MaturitySelector
  ├── CategoryPicker                (up to 3 from CATEGORY_ALLOWLIST)
  └── SubmitButton
```

---

## TTL Policy for Subcollection Documents

All subcollection documents copy `expiresAt` from the parent room at write time, enabling Firestore TTL to delete them automatically without Cloud Functions.

```
rooms/{roomId}               expiresAt: openedAt + 24–26 h  (TTL field)
  messages/{messageId}       expiresAt: == room.expiresAt
  participants/{userId}      expiresAt: == room.expiresAt
  rateLimits/{userId}        expiresAt: == room.expiresAt
```

The `expiresAt` field must be enabled as the TTL field for each collection group in the Firebase console.

---

## Property-Based Test Design

All properties use fast-check with Vitest (`--run`) against the Firebase Emulator Suite. Each property uses `{ numRuns: 20 }`. Time control is achieved by writing rooms with arbitrary `openedAt` values via `withSecurityRulesDisabled`, then testing with a re-authenticated client subject to full rules.

| Property | What is generated | What is asserted |
|---|---|---|
| **Expiry_Interval** | `openedAt` offsets: open 1 s–23 h 59 m; expired 24 h 1 s–48 h (boundary excluded) | Rules permit in open range; reject in expired range |
| **Expired_Write_Rejection** | Rooms opened 24 h 1 s–48 h ago | Message write rejected with `permission-denied` |
| **Expired_Read_Rejection** | Same as above | Message read rejected with `permission-denied` |
| **Message_ID_Idempotency** | Random UUID v4 messageId | Two `setDoc` calls → exactly one Firestore document |
| **Sort_Correctness_EndingSoon** | 2–10 rooms with random `openedAt` values | Client `ending_soon` sort matches `[...rooms].sort((a,b)=>a.openedAt-b.openedAt)` |
| **Sort_Correctness_Busiest** | 2–10 rooms with random `postingParticipantCount` values | Client `busiest` sort matches `[...rooms].sort((a,b)=>b.count-a.count)` |
| **Probation_Link_Block** | Messages with URLs in mixed case, multi-line bodies | Write rejected for users within PROBATION_DURATION |
| **Age_Visibility_Query** | Rooms with each `maturityLabel`; queries issued per age band | `under_13` → only `all_ages`; `13_17` → `all_ages`/`13_plus`; `18_plus` → all |
| **Age_Visibility_Rules** | Rooms with each `maturityLabel`; direct `getDoc` per age band | Rules deny per the age matrix |
| **Age_Restricted_Post** | Message write attempts to `13_plus`/`18_plus` rooms by `under_13` users, and `18_plus` by `13_17` | Write rejected with `permission-denied` |
| **Immutable_Room_Fields** | Random attempts to update `type`, `maturityLabel`, `openedAt`, `expiresAt`, `createdBy` | All updates rejected with `permission-denied` |
| **Room_Field_Allowlist** | Room/message create with extra fields | Creation rejected with `permission-denied` |
| **createdAt_Immutable** | Update attempts changing `createdAt` or `ageBandLabel` | All updates rejected with `permission-denied` |
| **Spoofed_createdAt_On_Create** | User create attempts with `createdAt != request.time` (past or future timestamps) | Creation rejected with `permission-denied` |
| **Cross_User_Read_Denied** | Attempt to read `users/{otherUserId}` as a different authenticated user | Read rejected with `permission-denied` |
| **RateLimit_Sentinel_Required** | Message batch without rateLimits write | Rejected with `permission-denied` (getAfter fails) |
| **Participant_Count_Tied** | Room update `+1` without matching participant create | Rejected with `permission-denied` (existsAfter fails) |
| **Participant_Message_Tied** | Three sub-cases: (a) `firstMessageId` not in batch; (b) `firstMessageId` points to a pre-existing message; (c) `firstMessageId` points to a message in the same batch but owned by a different user | All rejected with `permission-denied` |
| **Category_Allowlist** | Room creates with categories outside the allowlist | Rejected with `permission-denied` |

```typescript
// Example: Expiry_Interval property
it('Expiry_Interval', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(
        fc.integer({ min: 1,     max: 86399  }), // open: 1 s to 23 h 59 m 59 s ago
        fc.integer({ min: 86401, max: 172800 }), // expired: 24 h 1 s to 48 h ago
      ),
      async (offsetSeconds) => {
        const openedAt  = Timestamp.fromMillis(Date.now() - offsetSeconds * 1000);
        const roomId    = await createRoomBypassed({ openedAt });
        const write     = () => sendTestMessage(roomId);
        const isExpired = offsetSeconds >= 86401;

        if (isExpired) {
          await expect(write()).rejects.toMatchObject({ code: 'permission-denied' });
        } else {
          await expect(write()).resolves.not.toThrow();
        }
      },
    ),
    { numRuns: 20 },
  );
});
```

## Correctness Properties

The following invariants must hold at all times and are verified by the property-based test suite.

### Property 1: Expiry_Interval

A room is open iff `request.time < openedAt + 86 400 s`; derived from `openedAt` only. Test offsets avoid the exact boundary second.

**Validates: Requirements 2.1, 2.2**

### Property 2: Expired_Write_Rejection

No message write is accepted when `request.time >= openedAt + 86 400 s`.

**Validates: Requirements 2.2**

### Property 3: Expired_Read_Rejection

No message read is accepted when `request.time >= openedAt + 86 400 s`.

**Validates: Requirements 2.3**

### Property 4: Message_ID_Idempotency

Two writes with the same `messageId` produce exactly one Firestore document.

**Validates: Requirements 6.3**

### Property 5: Sort_Correctness_EndingSoon

The `ending_soon` sort order produces a deterministically correct ordering for any set of rooms.

**Validates: Requirements 3.2**

### Property 6: Sort_Correctness_Busiest

The `busiest` client-side sort produces a deterministically correct ordering by `postingParticipantCount` descending for any set of rooms.

**Validates: Requirements 3.2, 3.3**

### Property 7: Probation_Link_Block

A user within PROBATION_DURATION cannot send a message containing a URL in any case or across multiple lines.

**Validates: Requirements 6.7**

### Property 8: Age_Visibility_Query

Firestore queries filtered by age band return only rooms the age band is permitted to see.

**Validates: Requirements 3.7, 3.8, 3.9**

### Property 9: Age_Visibility_Rules

Security Rules deny direct reads per the account-age/maturity matrix for all three age bands.

**Validates: Requirements 3.7, 3.8, 3.9**

### Property 10: Age_Restricted_Post

Security Rules reject message writes (and participant/room creates) to age-restricted rooms by users whose age band does not permit access.

**Validates: Requirements 4.2, 6.4**

### Property 11: Immutable_Room_Fields

Security Rules reject any update that changes `type`, `maturityLabel`, `openedAt`, `expiresAt`, or `createdBy`.

**Validates: Requirements 1.7**

### Property 12: Room_Field_Allowlist

Room and message creation is rejected if any field outside the allowed set is present.

**Validates: Requirements 1.5, 6.5**

### Property 13: createdAt_Immutable

Security Rules reject any update to `users/{userId}` that changes `createdAt` or `ageBandLabel`.

**Validates: Requirements 5.5**

### Property 14: Spoofed_createdAt_On_Create

Security Rules reject user document creation where `createdAt` does not equal `request.time`.

**Validates: Requirements 5.5**

### Property 15: Cross_User_Read_Denied

Security Rules reject any attempt to read another user's `users/{userId}` document.

**Validates: Requirements 5.4**

### Property 16: RateLimit_Sentinel_Required

A message write without a matching rateLimits update in the same batch is rejected because `getAfter` fails.

**Validates: Requirements 6.6**

### Property 17: Participant_Count_Tied

A room `postingParticipantCount + 1` update without a matching participant document creation in the same batch is rejected because `existsAfter` fails.

**Validates: Requirements 4.4**

### Property 18: Participant_Message_Tied

Three sub-cases all rejected: (a) `firstMessageId` not present in the batch; (b) `firstMessageId` points to a message that already exists before the batch; (c) `firstMessageId` points to a message in the same batch but whose `senderId` belongs to a different user.

**Validates: Requirements 4.4**

### Property 19: Category_Allowlist

Room creation with any category value outside the fixed allowlist is rejected by Security Rules.

**Validates: Requirements 1.4, 1.8**

## Error Handling

| Scenario | Client behaviour |
|---|---|
| Pre-check: room expired | Surface "This room has ended" immediately; do not send. |
| Pre-check: rate-limited (client clock) | Surface "Please wait a moment" immediately; do not send. |
| Pre-check: probation URL | Surface "You cannot include links during your first hour" immediately; do not send. |
| `permission-denied` on message or batch write | Read back the message doc. If it exists and `senderId == uid`, treat as success. Otherwise surface error to user. |
| Network/transient error on message send | Retry with the same `messageId` (safe: idempotent). |
| Participant doc exists on pre-send guard check | Skip first-message batch; call `sendSubsequentMessage` directly. |
| Room expired on join | Show "This room has ended" message; offer to return to discovery. |
| `permission-denied` on room discovery read | User age band does not allow this maturity label; silently exclude from list. |

## Testing Strategy

**Unit tests (Vitest, no emulator)**
- `reasonLabel()` — all label branches including "Open now", and edge times.
- `maturityFilter()` — all three age bands, verifying `in`-list values match Security Rules.
- `buildDiscoveryQuery()` — constraint composition per sort order and age band; confirms `busiest` uses `openedAt DESC`.
- `splitAndSort()` — section splitting for all three sort orders; busiest sort by count.
- `hasNoUrl()` — URL patterns in mixed case, multi-line bodies, false positives.
- `isExpired()` — boundary conditions (strictly before, at, and after the 24-hour mark).
- `handlePermissionDenied()` — both branches (found/not found).
- `preCheckSend()` — all three pre-check branches.

**Emulator-based property tests (fast-check + Vitest, `--run`, max 20 examples each)**
- All 19 correctness properties listed above.
- Each test uses `withSecurityRulesDisabled` to seed data with arbitrary timestamps, then re-authenticates with a test user to exercise the full rules.