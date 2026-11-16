# Requirements Document

## Introduction

This document covers the core rooms lifecycle for Volubly: creating rooms, enforcing a 24-hour expiry entirely through Firestore Security Rules (no Cloud Functions), discovering open rooms, joining them, and sending plain-text messages. Teen protections, Ghost-Mode pre-send check, and the catch-up summary are out of scope and live in separate specs.

## Glossary

| Term | Definition |
|---|---|
| Account_Age_Label | Immutable field on the user document: `under_13`, `13_17`, or `18_plus`. Stored as a label; a birth date is never stored. |
| Posting_Participant_Count | Count of distinct users who have sent at least one message in the room. Maintained via client-written participant records; updated within a few seconds. |
| Probation | A user is in probation when `now < account.createdAt + PROBATION_DURATION`. `PROBATION_DURATION` defaults to 1 hour and is a configurable constant in source code. Derived at runtime; never stored as a flag. |
| Reason_Label | A short, factual label shown on each room card explaining why the room is listed (e.g., "New room", "Ending in 2 h", "Opened today"). Engagement-based labels such as "Trending now", "Hot", or "Popular" are not permitted. |
| expiresAt | Firestore TTL timestamp stored on the room document solely for Firestore's automatic deletion. Set to between 24 and 26 hours after `request.time` at creation. Never used for enforcement. |
| openedAt | Server timestamp (`request.time`) written at room creation. The authoritative start of the 24-hour window. Immutable. |
| Public_Profile | A document in `publicProfiles/{userId}` containing `username` and `avatarUrl`. Readable by any authenticated user; writable only by the owner. |

## Requirements

### Requirement 1: Room Creation

**User Story:** As an authenticated user, I want to create a room, so that others can join and chat about a topic or event.

#### Acceptance Criteria

1. WHEN a user submits a room creation request, THE SYSTEM SHALL validate that `type` is one of `live_room` or `open_topic`.
2. WHEN a user submits a room creation request, THE SYSTEM SHALL validate that `maturityLabel` is one of `all_ages`, `13_plus`, or `18_plus`.
3. WHEN a user submits a room creation request, THE SYSTEM SHALL validate that `title` is between 1 and 120 characters inclusive.
4. WHEN a user submits a room creation request, THE SYSTEM SHALL validate that `categories` is a non-empty array of values drawn from the fixed category list, containing at most 3 entries.
5. WHEN a user submits a room creation request, THE Firestore Security Rules SHALL require `openedAt == request.time`, `postingParticipantCount == 0`, `createdBy == request.auth.uid`, and that the document contains only the allowed field set; the client MUST NOT supply `expiresAt` or any unlisted field.
6. WHEN a room document is created, THE Firestore Security Rules SHALL require `expiresAt` to be between `request.time + 86 400 s` and `request.time + 93 600 s` (24–26 hours), enforcing it as a TTL-only field range; this field is immutable after creation.
7. WHEN a room document is created, THE SYSTEM SHALL treat the fields `type`, `maturityLabel`, `openedAt`, `expiresAt`, and `createdBy` as immutable; Firestore Security Rules MUST reject any update to these fields after creation.
8. WHEN a user submits a room creation request with a `categories` value not in the fixed category list, THE SYSTEM SHALL reject the request.
9. WHEN a user submits a room creation request with more than 3 entries in `categories`, THE SYSTEM SHALL reject the request.

### Requirement 2: Room Expiry Enforcement

**User Story:** As a user, I want rooms to automatically become unavailable after 24 hours, so that conversations stay tied to live events.

#### Acceptance Criteria

1. THE SYSTEM SHALL treat a room as open when `request.time < room.openedAt + 86 400 s` and as expired otherwise; room status is never stored in a separate field.
2. WHEN any client attempts a write to a room document or its subcollections, THE Firestore Security Rules SHALL reject the write if `request.time >= resource.data.openedAt + duration.value(86400, 's')`.
3. WHEN any client attempts to read messages in a room, THE Firestore Security Rules SHALL reject the read if `request.time >= resource.data.openedAt + duration.value(86400, 's')`.
4. THE SYSTEM SHALL use `expiresAt` solely as a Firestore TTL hint for physical deletion; it MUST NOT appear in any Security Rule condition or enforcement logic.
5. WHEN a room has expired, THE SYSTEM SHALL present the UI in an expired state derived from `openedAt`; the client MUST NOT poll a stored status field.
6. THE SYSTEM SHALL store an `expiresAt` field on message, participant, and rateLimits documents set to the parent room's `expiresAt` value, so that Firestore TTL can delete subcollection documents together with the room.

### Requirement 3: Room Discovery

**User Story:** As a user, I want to browse currently open rooms, so that I can find conversations I care about.

#### Acceptance Criteria

1. THE SYSTEM SHALL display the discovery feed in two sections: "Your picks" (rooms whose categories intersect the user's chosen categories) followed by "Also live" (all other open rooms).
2. THE SYSTEM SHALL support three sort orders: `newest` (default, `openedAt` descending), `ending_soon` (`openedAt` ascending, so rooms closest to expiry sort first), and `busiest` (Posting_Participant_Count descending, performed client-side after fetching).
3. WHEN the user selects the `busiest` sort order, THE SYSTEM SHALL sort rooms client-side by `postingParticipantCount` descending after fetching; counts include only post-probation participants.
4. WHEN the user selects the `busiest` sort order, THE SYSTEM SHALL split the fetched rooms into "Your picks" and "Also live" categories client-side after sorting.
5. THE SYSTEM SHALL display a Reason_Label on each room card; the label MUST be factual and non-engagement-based. "Active today" MUST NOT be used; "Opened today" is the correct label for rooms opened within the current calendar day.
6. THE SYSTEM SHALL NOT display labels such as "Trending now", "Hot", or "Popular" on any room card.
7. WHEN enforcing age-based room visibility, THE Firestore Security Rules SHALL deny a list or get request for a `13_plus` or `18_plus` room to a user whose Account_Age_Label is `under_13`.
8. WHEN enforcing age-based room visibility, THE Firestore Security Rules SHALL deny a list or get request for an `18_plus` room to a user whose Account_Age_Label is `13_17`.
9. WHEN enforcing age-based room visibility, THE Firestore Security Rules SHALL permit a user with Account_Age_Label `18_plus` to read any room regardless of maturity label.
10. THE SYSTEM SHALL filter the discovery query to rooms where `openedAt > now - 86 400 s` to exclude expired rooms, without relying on a stored status field.
11. WHEN the client fetches rooms for `busiest` sort, THE SYSTEM SHALL issue a single Firestore query without an `orderBy` on `postingParticipantCount` and sort the results client-side.

### Requirement 4: Joining a Room

**User Story:** As a user, I want to join an open room, so that I can read and participate in its conversation.

#### Acceptance Criteria

1. WHEN a user attempts to join a room, THE SYSTEM SHALL check whether `now < room.openedAt + 86 400 s`; if expired, THE SYSTEM SHALL reject the join with a clear user-facing message.
2. WHEN a user attempts to join a room, THE Firestore Security Rules SHALL enforce age-based access: `under_13` users cannot read `13_plus` or `18_plus` rooms; `13_17` users cannot read `18_plus` rooms.
3. WHEN a user joins a room, THE SYSTEM SHALL show the Posting_Participant_Count, defined as the count of distinct users who have sent at least one message in the room.
4. THE SYSTEM SHALL update the Posting_Participant_Count within a few seconds of a new participant sending their first message.
5. THE SYSTEM SHALL NOT display a live-presence or "currently online" count; only the Posting_Participant_Count is shown.

### Requirement 5: User Profiles

**User Story:** As a user, I want my username and avatar to be visible to others in rooms, so that participants can identify who is speaking.

#### Acceptance Criteria

1. THE SYSTEM SHALL store `username` and `avatarUrl` in a `publicProfiles/{userId}` document, separate from the private user document.
2. THE Firestore Security Rules SHALL allow any authenticated user to read any `publicProfiles` document.
3. THE Firestore Security Rules SHALL allow a user to write only to their own `publicProfiles/{userId}` document (`request.auth.uid == userId`).
4. THE SYSTEM SHALL store account metadata (`createdAt`, `Account_Age_Label`) in a private `users/{userId}` document readable and writable only by the owner.
5. WHEN a user document is created, THE Firestore Security Rules SHALL require `createdAt == request.time` and treat `createdAt` and `Account_Age_Label` as immutable after creation.

### Requirement 6: Sending Messages

**User Story:** As a room participant, I want to send a plain-text message, so that I can contribute to the conversation.

#### Acceptance Criteria

1. WHEN a user submits a message, THE SYSTEM SHALL validate that the message body is plain text between 1 and 280 characters inclusive; empty messages and messages exceeding 280 characters MUST be rejected.
2. WHEN a user submits a message, THE SYSTEM SHALL require the client to supply a UUID v4 `messageId`; this value is used as the Firestore document ID.
3. WHEN a client submits a message with a `messageId` that already exists in Firestore, THE SYSTEM SHALL treat the write as a no-op success; the client MUST interpret a "document already exists" response as a successful send, not an error.
4. WHEN a user submits a message, THE Firestore Security Rules SHALL verify that the `senderId` field equals `request.auth.uid`.
5. WHEN a user submits a message, THE Firestore Security Rules SHALL reject the write if the message document contains any field not in the allowed set: `messageId`, `senderId`, `body`, `sentAt`, `roomId`, `expiresAt`.
6. WHEN a user submits more than one message within a 3-second window in the same room, THE Firestore Security Rules SHALL reject the second write using `exists()` on the rateLimits document and `getAfter()` to verify `lastMessageAt == request.time` after the update; the rate-limit record MUST be a client-written document that Security Rules can inspect.
7. WHEN a user in probation submits a message containing a URL pattern, THE Firestore Security Rules SHALL reject the write; the URL check MUST be case-insensitive and handle multi-line body text.
8. WHEN a user sends their first message in a room, THE SYSTEM SHALL write the message, the participant document, and the `postingParticipantCount` increment as a single client-initiated batch; if the batch fails because the participant document already exists, THE SYSTEM SHALL retry with the message write only.
9. WHEN a user sends a message and the participant document creation succeeds but the overall batch fails, THE SYSTEM SHALL detect the orphaned participant document on the next send attempt and proceed with message-only write.

### Requirement 7: Property-Based Tests

**User Story:** As a developer, I want property-based tests that run against the Firebase Emulator, so that Security Rules and data invariants are verified automatically.

#### Acceptance Criteria

1. THE SYSTEM SHALL implement property-based tests using fast-check and Vitest in `--run` mode against the Firebase Emulator Suite.
2. WHEN running emulator-based property tests, THE SYSTEM SHALL use at most 20 generated examples per property to keep the suite fast.
3. THE SYSTEM SHALL include a property **Expiry_Interval**: Security Rules permit writes when `t < T + 86 400 s` and reject writes when `t >= T + 86 400 s`, using `openedAt` exclusively.
4. THE SYSTEM SHALL include a property **Expired_Write_Rejection**: no message write is accepted by Security Rules when `request.time >= room.openedAt + 86 400 s`.
5. THE SYSTEM SHALL include a property **Expired_Read_Rejection**: no message read is accepted by Security Rules when `request.time >= room.openedAt + 86 400 s`.
6. THE SYSTEM SHALL include a property **Message_ID_Idempotency**: submitting the same `messageId` twice produces exactly one Firestore document.
7. THE SYSTEM SHALL include a property **Sort_Correctness**: the `ending_soon` sort order produces a deterministically correct ordering for any generated set of rooms.
8. THE SYSTEM SHALL include a property **Probation_Link_Block**: a user whose `createdAt` is within PROBATION_DURATION cannot send a message containing a URL (tested with URLs in mixed case and multi-line bodies).
9. THE SYSTEM SHALL include a property **Age_Visibility**: Security Rules deny a read of a `13_plus` room to `under_13` users, and deny a read of an `18_plus` room to `under_13` or `13_17` users.
10. THE SYSTEM SHALL include a property **Immutable_Room_Fields**: Security Rules reject any update attempt that changes `type`, `maturityLabel`, `openedAt`, `expiresAt`, or `createdBy`.
11. THE SYSTEM SHALL include a property **Room_Field_Allowlist**: Security Rules reject room creation if any field outside the allowed set is present, and reject message creation if any field outside the allowed message set is present.
12. THE SYSTEM SHALL include a property **createdAt_Immutable**: Security Rules reject any update to `users/{userId}` that changes `createdAt` or `Account_Age_Label`.