# Implementation Plan: Rooms and Expiry

## Overview

Implement the core rooms lifecycle for Volubly in eight ordered groups: (0) project scaffold; (1) Firestore Security Rules; (2) emulator test harness; (3) all 19 property-based tests run against the emulator to lock down enforcement before any client code is written; (4) Firestore composite indexes; (5) TypeScript data models and shared constants; (6) pure client utility functions and their unit tests; (7) message send logic; (8) React components; (9) Firebase initialisation, account creation, real-time listener, and expiry countdown wiring.

The stack is TypeScript + Vite + React + Tailwind CSS + Firestore + fast-check + Vitest as specified in the tech steering.

## Tasks

- [x] 0. Scaffold project
  - [x] 0.1 Initialise a Vite + React + TypeScript project at the repository root using `npm create vite@latest . -- --template react-ts`; install production dependencies: `firebase`; install dev dependencies: `tailwindcss`, `postcss`, `autoprefixer`, `vitest`, `@vitest/ui`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `fast-check`, `@firebase/rules-unit-testing`, `firebase-admin`; initialise Tailwind with `npx tailwindcss init -p` and configure `content` to include `./src/**/*.{ts,tsx}`
    - _Requirements: (project prerequisite)_
  - [x] 0.2 Add npm scripts to `package.json`: `"test": "vitest --run"` and `"test:emulator": "vitest --run --config vitest.emulator.config.ts"`; verify `npm test` exits 0 with no test files (empty run is acceptable)
    - _Requirements: (project prerequisite)_
  - [x] 0.3 Write `README.md` at the repository root listing prerequisites (Node >= 20 LTS, Java >= 11 required by Firebase Emulator Suite), setup steps (`npm install`, `npm test`, `npm run test:emulator`), and a one-paragraph description of Volubly
    - _Requirements: (project prerequisite)_

- [x] 1. Write Firestore Security Rules
  - [x] 1.1 Create `firestore.rules` with all helpers (`isAuthed`, `userDoc`, `ageBand`, `roomIsOpen`, `isInProbation`, `hasNoUrl`, `ageCanReadRoom`) and all collection rules (`publicProfiles`, `users`, `rooms`, `rooms/messages`, `rooms/participants`, `rooms/rateLimits`) exactly as specified in the design
    - Implement the `rules_version = '2'` file at the repository root
    - Include all field-set, type, value, and immutability constraints from the data model section of the design
    - For `rooms/participants`: `firstMessageId` must satisfy three conditions: `!exists` on the message before the batch, `existsAfter` on the message after the batch, and `getAfter(...).data.senderId == request.auth.uid`
    - _Requirements: 1.1–1.9, 2.1–2.4, 3.7–3.9, 4.1–4.2, 5.1–5.5, 6.1–6.7_

- [x] 2. Set up emulator test harness
  - [x] 2.1 Configure Firebase Emulator Suite for Firestore (`firebase.json`, `firestore.rules` path, emulator ports) and add Vitest config with `--run` mode and a `testEnvironment` that initialises the Firestore emulator SDK
    - Add a `tests/emulator/` directory with a shared `setup.ts` that exports `getTestFirestore`, `withSecurityRulesDisabled`, and `createAuthenticatedClient` helpers
    - _Requirements: 7.1_
  - [x] 2.2 Add a `vitest.emulator.config.ts` that points to the emulator test files and sets `pool: 'forks'` to avoid SDK singleton conflicts
    - Confirm the `test:emulator` npm script added in task 0.2 works: `vitest --run --config vitest.emulator.config.ts`
    - _Requirements: 7.1, 7.2_

- [ ] 3. Write all 19 property-based tests
  - [~] 3.1 Write **Property 1 – Expiry_Interval**: generate offsets in [1 s, 86 399 s] (open) and [86 401 s, 172 800 s] (expired); assert write permitted / rejected accordingly; `numRuns: 20`
    - _Requirements: 7.3, 2.1, 2.2_
  - [~] 3.2 Write **Property 2 – Expired_Write_Rejection**: seed rooms with `openedAt` between 24 h 1 s and 48 h ago; assert every message write is rejected with `permission-denied`; `numRuns: 20`
    - _Requirements: 7.4, 2.2_
  - [~] 3.3 Write **Property 3 – Expired_Read_Rejection**: seed same expired rooms; assert every message read is rejected with `permission-denied`; `numRuns: 20`
    - _Requirements: 7.5, 2.3_
  - [~] 3.4 Write **Property 4 – Message_ID_Idempotency**: generate random UUID v4 `messageId`; call `setDoc` twice with the same ID; assert exactly one document exists in Firestore; `numRuns: 20`
    - _Requirements: 7.6, 6.3_
  - [~] 3.5 Write **Property 5 – Sort_Correctness_EndingSoon**: generate 2–10 rooms with random `openedAt` values; assert client `ending_soon` output matches `[...rooms].sort((a,b) => a.openedAt - b.openedAt)`; `numRuns: 20`
    - _Requirements: 7.7, 3.2_
  - [~] 3.6 Write **Property 6 – Sort_Correctness_Busiest**: generate 2–10 rooms with random `postingParticipantCount`; assert client `busiest` output matches `[...rooms].sort((a,b) => b.count - a.count)`; `numRuns: 20`
    - _Requirements: 3.2, 3.3_
  - [~] 3.7 Write **Property 7 – Probation_Link_Block**: generate messages with URLs in mixed case and multi-line bodies; seed user with `createdAt = now - random(0, PROBATION_DURATION-1)`; assert write rejected; `numRuns: 20`
    - _Requirements: 7.8, 6.7_
  - [~] 3.8 Write **Property 8 – Age_Visibility_Query**: seed rooms with each `maturityLabel`; run discovery queries as each age band; assert returned set matches the allowed matrix; `numRuns: 20`
    - _Requirements: 3.7–3.9_
  - [~] 3.9 Write **Property 9 – Age_Visibility_Rules**: seed rooms with each `maturityLabel`; call `getDoc` as each age band; assert Security Rules deny per the matrix; `numRuns: 20`
    - _Requirements: 7.9, 3.7–3.9_
  - [~] 3.10 Write **Property 10 – Age_Restricted_Post**: generate message writes to `13_plus`/`18_plus` rooms by `under_13` users and to `18_plus` rooms by `13_17` users; assert all rejected; `numRuns: 20`
    - _Requirements: 4.2, 6.4_
  - [~] 3.11 Write **Property 11 – Immutable_Room_Fields**: generate update attempts changing `type`, `maturityLabel`, `openedAt`, `expiresAt`, or `createdBy`; assert all rejected; `numRuns: 20`
    - _Requirements: 7.10, 1.7_
  - [~] 3.12 Write **Property 12 – Room_Field_Allowlist**: generate room/message creates with extra fields appended; assert all rejected; `numRuns: 20`
    - _Requirements: 7.11, 1.5, 6.5_
  - [~] 3.13 Write **Property 13 – createdAt_Immutable**: generate update attempts to `users/{userId}` changing `createdAt` or `ageBandLabel`; assert all rejected; `numRuns: 20`
    - _Requirements: 7.12, 5.5_
  - [~] 3.14 Write **Property 14 – Spoofed_createdAt_On_Create**: generate user creates with `createdAt != request.time` (past and future); assert all rejected; `numRuns: 20`
    - _Requirements: 5.5_
  - [~] 3.15 Write **Property 15 – Cross_User_Read_Denied**: generate authenticated reads of `users/{otherUserId}` where caller UID ≠ document UID; assert all rejected; `numRuns: 20`
    - _Requirements: 5.4_
  - [~] 3.16 Write **Property 16 – RateLimit_Sentinel_Required**: generate message batches that omit the `rateLimits` write; assert all rejected because `getAfter` fails; `numRuns: 20`
    - _Requirements: 6.6_
  - [~] 3.17 Write **Property 17 – Participant_Count_Tied**: generate room `postingParticipantCount + 1` updates without a matching participant document create in the same batch; assert all rejected; `numRuns: 20`
    - _Requirements: 4.4_
  - [~] 3.18 Write **Property 18 – Participant_Message_Tied**: three sub-cases, all must be rejected: (a) participant create with a `firstMessageId` whose message is not in the batch at all; (b) participant create where `firstMessageId` points to a message that already exists in Firestore (pre-existing, not newly created); (c) participant create where `firstMessageId` points to a message being created in the same batch but whose `senderId` belongs to a different user; `numRuns: 20`
    - _Requirements: 4.4_
  - [~] 3.19 Write **Property 19 – Category_Allowlist**: generate room creates with one or more categories outside the fixed allowlist; assert all rejected; `numRuns: 20`
    - _Requirements: 1.4, 1.8_

- [~] 4. Checkpoint — Security Rules verified
  - Run `test:emulator` and confirm all 19 properties pass. Ask the user if any property fails or if the emulator won't start.

- [ ] 5. Write Firestore composite indexes
  - [~] 5.1 Create `firestore.indexes.json` at the repository root with the two composite indexes defined in the design: `maturityLabel ASC + openedAt DESC` and `maturityLabel ASC + openedAt ASC`; set `fieldOverrides: []`
    - _Requirements: 3.2, 3.11_

- [ ] 6. Define TypeScript data models and shared constants
  - [~] 6.1 Create `src/types/index.ts` exporting `AgeBandLabel`, `MaturityLabel`, `Category`, `CATEGORY_ALLOWLIST`, `PROBATION_DURATION_S = 3600`, and Firestore document interfaces `Room`, `Message`, `Participant`, `RateLimit`, `PublicProfile`, `UserDoc`
    - `Category` is `typeof CATEGORY_ALLOWLIST[number]`
    - All interfaces must reflect the exact field names and types from the design data model
    - _Requirements: 1.1–1.6, 5.1, 5.4, 6.1–6.2_
  - [~] 6.2 Create `src/lib/appError.ts` exporting `AppError` class with a `code` field and the error codes used in `preCheckSend` and `handlePermissionDenied` (`ROOM_EXPIRED`, `RATE_LIMITED`, `PROBATION_URL`, `MESSAGE_BLOCKED`)
    - _Requirements: 4.1, 6.1, 6.7_

- [ ] 7. Implement client utility functions
  - [~] 7.1 Create `src/lib/roomUtils.ts` and implement `isExpired(room: Room, now: Date): boolean` — returns `true` when `now.getTime() >= room.openedAt.toMillis() + 86_400_000`
    - _Requirements: 2.1, 2.5, 4.1_
  - [~] 7.2 Implement `reasonLabel(room: Room, now: Date): string` in `src/lib/roomUtils.ts` — all five branches from the design: "New room" (< 5 min), "Ending in N h" (< 2 h remaining), "Opened today", "Open now"; must never return "Active today", "Trending now", "Hot", or "Popular"
    - _Requirements: 3.5, 3.6_
  - [~] 7.3 Create `src/lib/discoveryUtils.ts` and implement `maturityFilter(ageBand: AgeBandLabel): QueryConstraint | null` — mirrors `ageCanReadRoom()` in Security Rules exactly; `under_13` → `==`, `13_17` → `in`, `18_plus` → `null`
    - _Requirements: 3.7–3.9_
  - [~] 7.4 Implement `buildDiscoveryQuery(ageBand, sortOrder)` in `src/lib/discoveryUtils.ts` — includes `openedAt > cutoff` filter, `limit(100)`, maturity filter, and `orderBy`; `busiest` uses `openedAt DESC` with no `orderBy` on count
    - _Requirements: 3.2, 3.10, 3.11_
  - [~] 7.5 Implement `splitAndSort(rooms, userCategories, sortOrder)` in `src/lib/discoveryUtils.ts` — `busiest` sorts client-side by `postingParticipantCount` desc before splitting; `newest`/`ending_soon` arrive pre-sorted
    - _Requirements: 3.1–3.4_
  - [~] 7.6 Create `src/lib/messageUtils.ts` and implement `hasNoUrl(text: string): boolean` — mirrors the `(?is).*(https?://|www\\.).*` pattern from Security Rules; must handle mixed case and multi-line input
    - _Requirements: 6.7_
  - [~] 7.7 Implement `preCheckSend(room, uid, body, lastSentAt)` in `src/lib/messageUtils.ts` — throws `AppError` for each of the three pre-check branches: expiry, rate limit (< 3 s), probation URL
    - _Requirements: 4.1, 6.1, 6.7_
  - [~] 7.8 Implement `handlePermissionDenied(roomId, uid, message)` in `src/lib/messageUtils.ts` — reads back the message doc; if it exists and `senderId == uid` returns silently; otherwise throws `MESSAGE_BLOCKED`
    - _Requirements: 6.3_
  - [~] 7.9 Write unit tests for all utilities in `src/lib/__tests__/roomUtils.test.ts` and `src/lib/__tests__/discoveryUtils.test.ts` using Vitest (no emulator):
    - `isExpired`: boundary (1 ms before, at, 1 ms after the 24 h mark)
    - `reasonLabel`: all five label branches including "Open now" and "Ending in 1 h"
    - `maturityFilter`: all three age bands; verify `in`-list values match Security Rules
    - `buildDiscoveryQuery`: constraint count and types per sort order and age band; `busiest` has no `orderBy` on count
    - `splitAndSort`: "Your picks" / "Also live" split for all three sort orders; `busiest` sorted descending by count
    - _Requirements: 3.1–3.6, 3.7–3.9, 2.1_
  - [~] 7.10 Write unit tests for message utilities in `src/lib/__tests__/messageUtils.test.ts` using Vitest (no emulator):
    - `hasNoUrl`: http, https, www, mixed case, multi-line, false positives that should pass
    - `preCheckSend`: expired room throws `ROOM_EXPIRED`; rate-limited throws `RATE_LIMITED`; probation URL throws `PROBATION_URL`; clean message does not throw
    - `handlePermissionDenied`: doc exists with correct sender → no throw; doc not found → throws `MESSAGE_BLOCKED`
    - _Requirements: 6.1, 6.7_

- [~] 8. Checkpoint — All unit tests pass
  - Run `vitest --run` (no emulator). Confirm all tests in `src/lib/__tests__/` pass. Ask the user if anything is red.

- [ ] 9. Implement message send logic
  - [~] 9.1 Create `src/lib/sendMessage.ts` and implement `sendFirstMessage(roomId, uid, message, roomExpiresAt)` — builds the four-document batch (participant + room increment + message + rateLimits), commits it, calls `handlePermissionDenied` on `permission-denied`
    - Import types from `src/types/index.ts`; use `writeBatch`, `serverTimestamp`, `increment` from the Firestore SDK
    - _Requirements: 6.8, 4.3–4.4_
  - [~] 9.2 Implement `sendSubsequentMessage(roomId, uid, message, roomExpiresAt)` in `src/lib/sendMessage.ts` — two-document batch (message + rateLimits); same error handling
    - _Requirements: 6.8_
  - [~] 9.3 Implement the orphaned-participant guard in a shared `sendMessage` entry-point function: call `getDoc` on the participant ref before the first send; if the doc already exists, skip to `sendSubsequentMessage`
    - _Requirements: 6.9_

- [ ] 10. Build React components — Discovery
  - [~] 10.1 Create `src/components/discovery/RoomCard.tsx` rendering: room title, `MaturityBadge` (all_ages / 13_plus / 18_plus), `ReasonLabel` (from `reasonLabel()`), `PostingParticipantCount`, and `ExpiryCountdown` (derived from `openedAt` via `isExpired`; no polling of a stored status field)
    - _Requirements: 3.5, 3.6, 4.3, 4.5, 2.5_
  - [~] 10.2 Create `src/components/discovery/RoomSection.tsx` rendering a labelled section header ("Your picks" or "Also live") with a list of `RoomCard` components
    - _Requirements: 3.1_
  - [~] 10.3 Create `src/components/discovery/SortOrderTabs.tsx` with three tabs: "Live now" (newest), "Ending soon", "Busiest"; calls `buildDiscoveryQuery` on tab change
    - _Requirements: 3.2_
  - [~] 10.4 Create `src/pages/DiscoveryPage.tsx` composing `SortOrderTabs` + two `RoomSection` components; subscribes to the discovery query with `onSnapshot`; calls `splitAndSort` to partition results; filters expired rooms via `openedAt > cutoff` without reading a stored status
    - _Requirements: 3.1–3.4, 3.10_

- [ ] 11. Build React components — Room creation
  - [~] 11.1 Create `src/components/createRoom/CreateRoomSheet.tsx` with `TypeSelector` (live_room / open_topic), `TitleInput` (1–120 chars), `MaturitySelector` (all_ages / 13_plus / 18_plus), `CategoryPicker` (up to 3 from `CATEGORY_ALLOWLIST`), and `SubmitButton`
    - Validate all fields client-side before writing; write to `rooms/{roomId}` via Firestore SDK with `openedAt: serverTimestamp()` and `expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000)` (within the 24–26 h TTL window)
    - _Requirements: 1.1–1.9_

- [ ] 12. Build React components — Room view
  - [~] 12.1 Create `src/components/room/MessageComposer.tsx` with a plain-text `TextArea` (1–280 chars) and `SendButton`; calls `preCheckSend` before dispatch and displays the appropriate error for each `AppError` code
    - _Requirements: 6.1, 6.7, 4.1_
  - [~] 12.2 Create `src/components/room/MessageItem.tsx` resolving `publicProfiles/{senderId}` for username and `avatarSeed`; renders avatar deterministically from `avatarSeed`
    - _Requirements: 5.1–5.3_
  - [~] 12.3 Create `src/components/room/MessageList.tsx` subscribing to `rooms/{roomId}/messages` ordered by `sentAt`; renders `MessageItem` list with optimistic entries keyed on `messageId`; replaces optimistic entry in-place when real-time snapshot delivers the same `messageId`
    - _Requirements: 6.2–6.3_
  - [~] 12.4 Create `src/components/room/RoomHeader.tsx` showing room title, participant count from the room document, and an `ExpiryCountdown` that derives remaining time from `openedAt` without polling a stored field; shows "This room has ended" when `isExpired` returns `true`
    - _Requirements: 4.3–4.5, 2.5_
  - [~] 12.5 Create `src/pages/RoomPage.tsx` composing `RoomHeader`, `MessageList`, `MessageComposer`; gates entry with an expiry check (`isExpired`) and an age-band check; wires `sendMessage` to the composer submit
    - _Requirements: 4.1–4.2, 6.8–6.9_

- [ ] 13. Firebase initialisation and account creation
  - [~] 13.1 Create `src/lib/firebase.ts` initialising the Firebase app with Auth, Firestore, and App Check; export typed `db`, `auth`, and `appCheck` instances
    - _Requirements: (infrastructure prerequisite for all Firestore operations)_
  - [~] 13.2 Create `src/lib/account.ts` implementing the user onboarding write: a `writeBatch` that creates `users/{uid}` (`createdAt: serverTimestamp()`, `ageBandLabel`) and `publicProfiles/{uid}` (`username`, `avatarSeed`) atomically
    - _Requirements: 5.1–5.5_

- [ ] 14. Real-time listener and expiry countdown
  - [~] 14.1 Create `src/hooks/useMessages.ts` — a React hook wrapping `onSnapshot` on `rooms/{roomId}/messages`; merges optimistic messages with real messages using `messageId` as the key; cancels the subscription on unmount
    - _Requirements: 6.2–6.3_
  - [~] 14.2 Create `src/hooks/useExpiryCountdown.ts` — a React hook that takes `openedAt: Timestamp` and returns `{ remainingMs, isExpired }`; derives state from `openedAt` only using `setInterval`; clears interval when `isExpired` becomes `true`
    - _Requirements: 2.5, 4.5_

- [~] 15. Final checkpoint — All tests pass
  - Run `vitest --run` (unit tests) and `test:emulator` (emulator property tests). Confirm everything is green. Ask the user before proceeding if any test is failing.

## Notes

- Property-based tests (tasks 3.1–3.19) are **required** and must not be skipped. They are the primary verification layer for Security Rules before any UI is written.
- Each property uses `numRuns: 20` and seeds Firestore with `withSecurityRulesDisabled` for time-controlled data, then re-authenticates to exercise full rules.
- `PROBATION_DURATION_S` is defined as a constant in `src/types/index.ts` and must be imported everywhere it is used — never hardcoded.
- `expiresAt` is never read in Security Rules enforcement; it is a Firestore TTL-only field. Any rule that checks `expiresAt` for open/closed logic is a bug.
- The `busiest` query issues a single Firestore query without `orderBy('postingParticipantCount')` and sorts client-side.
- The `messageId` field doubles as the Firestore document ID; retrying with the same `messageId` is safe and idempotent.
- Checkpoints at tasks 4, 8, and 15 gate forward progress.
- **Property 18** covers three distinct rejection cases: missing message in batch, pre-existing message (not new), and message created in same batch but owned by a different user.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.1"] },
    { "id": 1, "tasks": ["0.2", "0.3"] },
    { "id": 2, "tasks": ["1.1"] },
    { "id": 3, "tasks": ["2.1", "2.2"] },
    { "id": 4, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "3.11", "3.12", "3.13", "3.14", "3.15", "3.16", "3.17", "3.18", "3.19"] },
    { "id": 5, "tasks": ["5.1", "6.1", "6.2"] },
    { "id": 6, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8"] },
    { "id": 7, "tasks": ["7.9", "7.10"] },
    { "id": 8, "tasks": ["9.1", "9.2", "13.1", "13.2"] },
    { "id": 9, "tasks": ["9.3"] },
    { "id": 10, "tasks": ["10.1", "10.2", "10.3", "11.1", "12.1", "12.2"] },
    { "id": 11, "tasks": ["10.4", "12.3", "12.4", "14.1", "14.2"] },
    { "id": 12, "tasks": ["12.5"] }
  ]
}
```