# Implementation Plan: Rooms and Expiry

## Overview

Implement the core rooms lifecycle for Volubly in ordered groups: (0) project scaffold; (1) Firestore Security Rules; (2) emulator test harness and sanity tests; (3) negative property-based tests for all Security Rules; (4) Firestore composite indexes; (5) TypeScript data models and constants; (6) pure client utilities and unit tests; (7) client-side sort/filter properties (depend on Task 6); (8) message send logic; (9) Firebase initialisation, environment config, and account creation; (10) sign-in and onboarding; (11) React components; (12) PWA, theme, and deploy; (13) hooks and infra; (14) docs.

The stack is TypeScript + Vite + React + Tailwind CSS + Firestore + fast-check + Vitest.

## Tasks

- [ ] 0. Scaffold project
  - [ ] 0.1 Initialise a Vite + React + TypeScript project at the repository root; install production dependencies `firebase`; install dev dependencies `tailwindcss`, `postcss`, `autoprefixer`, `vitest`, `@vitest/ui`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `fast-check`, `@firebase/rules-unit-testing`, `firebase-admin`; initialise Tailwind and configure `content` for `./src/**/*.{ts,tsx}`
    - _Requirements: (project prerequisite)_
  - [ ] 0.2 Add npm scripts: `"test": "vitest --run"` and `"test:emulator": "firebase emulators:exec --only firestore \"vitest --run --config vitest.emulator.config.ts\""`; verify `npm test` exits 0
    - _Requirements: (project prerequisite)_
  - [ ] 0.3 Write `README.md` listing prerequisites (Node >= 20 LTS, Java >= 11 for the Firebase Emulator), setup steps, and a one-paragraph description of Volubly
    - _Requirements: (project prerequisite)_

- [ ] 1. Write Firestore Security Rules
  - [ ] 1.1 Create `firestore.rules` with all helpers (`isAuthed`, `userDoc`, `ageBand`, `roomIsOpen`, `isInProbation`, `hasNoUrl`, `ageCanReadRoom`) and all collection rules (`publicProfiles`, `users`, `rooms`, `rooms/messages`, `rooms/participants`, `rooms/rateLimits`) exactly as specified in the design; write as UTF-8 without BOM
    - For `rooms/participants`: `firstMessageId` must satisfy `!exists` on the message before the batch, `existsAfter` on the message after the batch, and `getAfter(...).data.senderId == request.auth.uid`
    - _Requirements: 1.1–1.9, 2.1–2.6, 3.6–3.9, 4.1–4.2, 5.1–5.5, 6.1–6.9_

- [ ] 2. Set up emulator test harness and sanity tests
  - [ ] 2.1 Write `firebase.json` (Firestore emulator port 8080, rules: `firestore.rules`); write `vitest.emulator.config.ts` (node env, `include: tests/rules/**/*.test.ts`, pool: forks, 30 s timeouts); write `tests/rules/helpers.ts` exporting `getEnv`, `teardown`, `clearData`, `userADb`, `userBDb`, `unauthDb`, `adminDb`; add a smoke test `tests/rules/smoke.test.ts` asserting unauthenticated reads of rooms are denied; all files UTF-8 without BOM
    - _Requirements: 7.1_
  - [ ] 2.2 Write `tests/rules/sanity.test.ts` with valid-path tests that SUCCEED:
    - Create a `users` document (createdAt == serverTimestamp, ageBandLabel == '18_plus')
    - Create a `publicProfiles` document (username, avatarSeed)
    - Create a room (all required fields; `expiresAt` = now + 25 h, i.e. `Timestamp.fromMillis(Date.now() + 90_000_000)`)
    - First-message batch: participant doc + room `postingParticipantCount` increment + message doc + rateLimits doc, all in one `writeBatch`
    - Subsequent-message batch: message doc + rateLimits update, with a fresh `messageId` and after waiting > 3 s (or seeding a stale rateLimits doc via `adminDb`)
    - _Requirements: 1.1–1.6, 2.1–2.2, 5.1–5.5, 6.1–6.9_
  - [ ] 2.3 Add a Kiro hook at `.kiro/hooks/on-rules-save.json` that runs `npm run test:emulator` whenever `firestore.rules` is saved

- [ ] 3. Write all 19 property-based tests
  - Each property uses `numRuns: 20`. Every negative property MUST include a matching valid case that asserts `assertSucceeds` (same setup, valid data). Seed data via `adminDb` using `withSecurityRulesDisabled`.
  - [ ] 3.1 Write **Property 1 – Expiry_Interval**: generate offsets in [1 s, 86 399 s] (open) and [86 401 s, 172 800 s] (expired), avoiding the exact boundary; assert write permitted / rejected accordingly; include a valid case with an open-range offset
    - _Requirements: 7.3, 2.1, 2.2_
  - [ ] 3.2 Write **Property 2 – Expired_Write_Rejection**: seed rooms with `openedAt` between 24 h 1 s and 48 h ago; assert every message write is rejected; include a valid case with an open room
    - _Requirements: 7.4, 2.2_
  - [ ] 3.3 Write **Property 3 – Expired_Read_Rejection**: seed same expired rooms; assert every message read is rejected; include a valid case with an open room
    - _Requirements: 7.5, 2.3_
  - [ ] 3.4 Write **Property 4 – Message_ID_Idempotency**: generate random UUID v4 `messageId`; submit identical batch twice; assert exactly one Firestore document exists; `numRuns: 20`
    - _Requirements: 7.6, 6.2_
  - [ ] 3.5 Write **Property 7 – Probation_Link_Block**: generate messages with URLs in mixed case and multi-line bodies; seed user `createdAt = now - random(0, 3599)s`; assert write rejected; include a valid case with a URL-free body
    - _Requirements: 7.9, 6.7_
  - [ ] 3.6 Write **Property 9 – Age_Visibility_Rules**: seed rooms with each `maturityLabel`; call `getDoc` as each age band; assert Security Rules deny per the matrix; include valid cases for each permitted combination
    - _Requirements: 7.11, 3.6–3.8_
  - [ ] 3.7 Write **Property 10 – Age_Restricted_Post**: generate message writes to `13_plus`/`18_plus` rooms by `under_13` users and to `18_plus` rooms by `13_17` users; assert all rejected; include valid cases
    - _Requirements: 7.12, 4.2, 6.4_
  - [ ] 3.8 Write **Property 11 – Immutable_Room_Fields**: generate update attempts changing `type`, `maturityLabel`, `openedAt`, `expiresAt`, or `createdBy`; assert all rejected; include a valid update (title change only)
    - _Requirements: 7.13, 1.7_
  - [ ] 3.9 Write **Property 12 – Room_Field_Allowlist**: generate room/message creates with extra fields appended; assert all rejected; include valid creates
    - _Requirements: 7.14, 1.5, 6.5_
  - [ ] 3.10 Write **Property 13 – createdAt_Immutable**: generate update attempts to `users/{userId}` changing `createdAt` or `ageBandLabel`; assert all rejected; include a valid update that changes only a mutable field
    - _Requirements: 7.15, 5.5_
  - [ ] 3.11 Write **Property 14 – Spoofed_createdAt_On_Create**: generate user creates with `createdAt != request.time` (past and future); assert all rejected; include a valid create
    - _Requirements: 7.16, 5.5_
  - [ ] 3.12 Write **Property 15 – Cross_User_Read_Denied**: generate authenticated reads of `users/{otherUserId}` where caller UID != document UID; assert all rejected; include a valid self-read
    - _Requirements: 7.17, 5.4_
  - [ ] 3.13 Write **Property 16 – RateLimit_Sentinel_Required**: generate message batches that omit the `rateLimits` write; assert all rejected; include a valid batch that includes the rateLimits write
    - _Requirements: 7.18, 6.6_
  - [ ] 3.14 Write **Property 17 – Participant_Count_Tied**: generate room `postingParticipantCount + 1` updates without a matching participant create; assert all rejected; include a valid batch
    - _Requirements: 7.19, 4.4_
  - [ ] 3.15 Write **Property 18 – Participant_Message_Tied**: three sub-cases all rejected: (a) `firstMessageId` not in batch; (b) `firstMessageId` points to a pre-existing message; (c) `firstMessageId` message in batch but owned by a different user; include a valid first-message batch
    - _Requirements: 7.20, 4.4_
  - [ ] 3.16 Write **Property 19 – Category_Allowlist**: generate room creates with one or more categories outside the fixed allowlist; assert all rejected; include a valid create with allowlist categories
    - _Requirements: 7.21, 1.4, 1.8_
  - [ ] 3.17 Write **Property 20 – Valid_Room_Create_And_Write**: generate valid rooms (open, correct fields, expiresAt = now + 25 h) and valid first-message batches; assert all succeed
    - _Requirements: 1.1–1.9, 6.1–6.9_

- [ ] 4. Checkpoint — Security Rules verified
  - Run `npm run test:emulator` and confirm all tests pass. Stop and ask the user if any test is red.

- [ ] 5. Write Firestore composite indexes
  - [ ] 5.1 Create `firestore.indexes.json` at the repository root with indexes `maturityLabel ASC + openedAt DESC` and `maturityLabel ASC + openedAt ASC`; `fieldOverrides: []`; write UTF-8 without BOM
    - _Requirements: 3.2, 3.9_

- [ ] 6. Define TypeScript data models and shared constants
  - [ ] 6.1 Create `src/types/index.ts` exporting `AgeBandLabel`, `MaturityLabel`, `Category`, `CATEGORY_ALLOWLIST`, `PROBATION_DURATION_S = 3600`, and Firestore document interfaces `Room`, `Message`, `Participant`, `RateLimit`, `PublicProfile`, `UserDoc`; `Category` is `typeof CATEGORY_ALLOWLIST[number]`; all field names and types must match the design data model exactly
    - _Requirements: 1.1–1.6, 5.1, 5.4, 6.1–6.2_
  - [ ] 6.2 Create `src/lib/appError.ts` exporting class `AppError` with a `code` string field and codes `ROOM_EXPIRED`, `RATE_LIMITED`, `PROBATION_URL`, `MESSAGE_BLOCKED`
    - _Requirements: 4.1, 6.1, 6.7_

- [ ] 7. Implement client utility functions and unit tests
  - [ ] 7.1 Create `src/lib/roomUtils.ts`: `isExpired(room, now)` returns true when `now.getTime() >= room.openedAt.toMillis() + 86_400_000`
    - _Requirements: 2.1, 2.5, 4.1_
  - [ ] 7.2 Implement `reasonLabel(room, now)` in `src/lib/roomUtils.ts`: "New room" (< 5 min), "Ending in N h" (< 2 h remaining), "Opened today", "Open now"; must never return "Active today", "Active", "Trending now", "Hot", or "Popular"
    - _Requirements: 3.4, 3.5_
  - [ ] 7.3 Create `src/lib/discoveryUtils.ts`: `maturityFilter(ageBand)` mirrors `ageCanReadRoom()` in Security Rules exactly — `under_13` uses `==`, `13_17` uses `in`, `18_plus` returns null
    - _Requirements: 3.6–3.8_
  - [ ] 7.4 Implement `buildDiscoveryQuery(ageBand, sortOrder)` in `src/lib/discoveryUtils.ts`: `openedAt > cutoff`, `limit(100)`, maturity filter; `busiest` uses `orderBy('openedAt','desc')` with no server-side count sort
    - _Requirements: 3.2, 3.9_
  - [ ] 7.5 Implement `splitAndSort(rooms, userCategories, sortOrder)` in `src/lib/discoveryUtils.ts`: `busiest` sorts by `postingParticipantCount` desc before splitting; `newest`/`ending_soon` arrive pre-sorted
    - _Requirements: 3.1–3.3_
  - [ ] 7.6 Create `src/lib/messageUtils.ts`: `hasNoUrl(text)` mirrors `(?is).*(https?://|www\\.).*`; handles mixed case and multi-line
    - _Requirements: 6.7_
  - [ ] 7.7 Implement `preCheckSend(room, uid, body, lastSentAt, userCreatedAt)` in `src/lib/messageUtils.ts`: throws `AppError` for expiry, rate-limit (< 3 s), and probation URL; accepts `userCreatedAt: Date` to derive probation client-side
    - _Requirements: 4.1, 6.1, 6.7_
  - [ ] 7.8 Implement `handlePermissionDenied(messageId, roomId, uid, readFn)` in `src/lib/messageUtils.ts` where `readFn: (ref) => Promise<DocumentSnapshot>` is injected for testability; reads back the message doc; returns silently if exists with correct sender; throws `MESSAGE_BLOCKED` otherwise
    - _Requirements: 6.3_
  - [ ] 7.9 Write unit tests in `src/lib/__tests__/roomUtils.test.ts` and `src/lib/__tests__/discoveryUtils.test.ts` (Vitest, no emulator):
    - `isExpired`: 1 ms before, at, and 1 ms after the 24 h boundary
    - `reasonLabel`: all five branches including "Open now" and "Ending in 1 h"
    - `maturityFilter`: all three age bands; verify in-list values match Security Rules
    - `buildDiscoveryQuery`: constraint count and types per sort order and age band; `busiest` has orderBy openedAt desc, no orderBy on count
    - `splitAndSort`: "Your picks"/"Also live" split for all three sort orders; `busiest` sorted descending by count
    - _Requirements: 3.1–3.9, 2.1_
  - [ ] 7.10 Write unit tests in `src/lib/__tests__/messageUtils.test.ts` (Vitest, no emulator):
    - `hasNoUrl`: http, https, www, mixed case, multi-line, false positives
    - `preCheckSend`: expired throws `ROOM_EXPIRED`; rate-limited throws `RATE_LIMITED`; probation URL throws `PROBATION_URL`; clean message does not throw; passes `userCreatedAt` correctly
    - `handlePermissionDenied`: doc exists with correct sender -> no throw; doc missing -> throws `MESSAGE_BLOCKED`; uses injected `readFn`
    - _Requirements: 6.1, 6.3, 6.7_

- [ ] 8. Client-side sort and query property tests (depends on Task 7)
  - [ ] 8.1 Write **Property 5 – Sort_Correctness_EndingSoon** in `tests/rules/`: generate 2–10 rooms with random `openedAt` values; assert `splitAndSort` output matches `[...rooms].sort((a,b) => a.openedAt - b.openedAt)`; `numRuns: 20`; no emulator needed — pure function test using Vitest
    - _Requirements: 7.7, 3.2_
  - [ ] 8.2 Write **Property 6 – Sort_Correctness_Busiest** in `tests/rules/`: generate 2–10 rooms with random `postingParticipantCount`; assert `splitAndSort` output matches `[...rooms].sort((a,b) => b.count - a.count)`; `numRuns: 20`; pure function test
    - _Requirements: 7.8, 3.2, 3.3_
  - [ ] 8.3 Write **Property 8 – Age_Visibility_Query** in `tests/rules/`: seed rooms via `adminDb`; run `buildDiscoveryQuery` as each age band; assert returned set matches allowed matrix; `numRuns: 20`
    - _Requirements: 7.10, 3.6–3.8_

- [ ] 9. Implement message send logic
  - [ ] 9.1 Create `src/lib/sendMessage.ts`: `sendFirstMessage(roomId, uid, message, roomExpiresAt)` builds the four-document batch (participant + room increment + message + rateLimits), commits it, calls `handlePermissionDenied` on `permission-denied`
    - _Requirements: 6.8, 4.3–4.4_
  - [ ] 9.2 Implement `sendSubsequentMessage(roomId, uid, message, roomExpiresAt)` in `src/lib/sendMessage.ts`: two-document batch (message + rateLimits); same error handling
    - _Requirements: 6.8_
  - [ ] 9.3 Implement orphaned-participant guard in a `sendMessage` entry-point: `getDoc` on participant ref before first send; if exists, skip to `sendSubsequentMessage`
    - _Requirements: 6.9_

- [ ] 10. Environment config and Firebase initialisation
  - [ ] 10.1 Create `.env.example` listing all `VITE_FIREBASE_*` variables (`API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, `APP_ID`, `APPCHECK_DEBUG_TOKEN`); add `.env.local` to `.gitignore`
    - _Requirements: (infrastructure)_
  - [ ] 10.2 Create `src/lib/firebase.ts` reading `import.meta.env.VITE_FIREBASE_*`; initialise Firebase app, Auth, Firestore, and App Check; in development (`import.meta.env.DEV`) use the debug token from `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN`; export typed `db`, `auth`, `appCheck`
    - _Requirements: (infrastructure)_

- [ ] 11. Account creation and onboarding
  - [ ] 11.1 Create `src/lib/account.ts`: `createAccount(uid, ageBandLabel, username, avatarSeed)` writes `users/{uid}` and `publicProfiles/{uid}` atomically in one `writeBatch` with `createdAt: serverTimestamp()`
    - _Requirements: 5.1–5.5_
  - [ ] 11.2 Create `src/pages/OnboardingPage.tsx`: age-band selector (neutral, does not hint at age cutoffs) followed by username + avatar-seed picker; on submit calls `createAccount`; redirects to discovery on success
    - _Requirements: 5.1–5.5_
  - [ ] 11.3 Create `src/components/AuthGate.tsx`: calls `signInAnonymously` on first load if no user is signed in; shows a loading state while auth initialises; redirects signed-in users without a `users` doc to `OnboardingPage`; wraps the rest of the app
    - _Requirements: 5.1–5.5_

- [ ] 12. Build React components — Discovery
  - [ ] 12.1 Create `src/components/discovery/RoomCard.tsx`: room title, `MaturityBadge`, `ReasonLabel` (from `reasonLabel()`), `PostingParticipantCount`, `ExpiryCountdown` (from shared ticker, see Task 13.1); no per-card timer
    - _Requirements: 3.4, 3.5, 4.3, 4.5, 2.5_
  - [ ] 12.2 Create `src/components/discovery/RoomSection.tsx`: section header ("Your picks" or "Also live") with a list of `RoomCard`
    - _Requirements: 3.1_
  - [ ] 12.3 Create `src/components/discovery/SortOrderTabs.tsx`: tabs "Newest", "Ending soon", "Busiest"; calls `buildDiscoveryQuery` on change
    - _Requirements: 3.2_
  - [ ] 12.4 Create `src/pages/DiscoveryPage.tsx`: composes tabs + two `RoomSection`; subscribes via `onSnapshot`; calls `splitAndSort`; excludes expired rooms via `openedAt > cutoff`
    - _Requirements: 3.1–3.3, 3.9_

- [ ] 13. Build React components — Room creation
  - [ ] 13.1 Create `src/components/createRoom/CreateRoomSheet.tsx`: `TypeSelector`, `TitleInput` (1–120 chars), `MaturitySelector`, `CategoryPicker` (up to 3 from `CATEGORY_ALLOWLIST`), `SubmitButton`; sets `expiresAt = Timestamp.fromMillis(Date.now() + 90_000_000)` (25 h, within the 24–26 h TTL window); validates all fields client-side before writing
    - _Requirements: 1.1–1.9_

- [ ] 14. Build React components — Room view
  - [ ] 14.1 Create `src/components/room/MessageComposer.tsx`: plain-text `TextArea` (1–280 chars), `SendButton`; calls `preCheckSend(room, uid, body, lastSentAt, userCreatedAt)` before dispatch; displays appropriate error per `AppError` code
    - _Requirements: 6.1, 6.7, 4.1_
  - [ ] 14.2 Create `src/components/room/MessageItem.tsx`: resolves `publicProfiles/{senderId}` via the shared cache (Task 13.2); renders avatar from `avatarSeed`
    - _Requirements: 5.1–5.3_
  - [ ] 14.3 Create `src/components/room/MessageList.tsx`: subscribes to `rooms/{roomId}/messages` ordered by `sentAt`; renders `MessageItem` list with optimistic entries keyed on `messageId`; replaces optimistic entry in-place when real-time snapshot delivers the same `messageId`
    - _Requirements: 6.2–6.3_
  - [ ] 14.4 Create `src/components/room/RoomHeader.tsx`: room title, participant count, `ExpiryCountdown` from shared ticker; shows "This room has ended" when `isExpired` returns true
    - _Requirements: 4.3–4.5, 2.5_
  - [ ] 14.5 Create `src/pages/RoomPage.tsx`: composes `RoomHeader`, `MessageList`, `MessageComposer`; gates entry with expiry check and age-band check; wires `sendMessage` to composer submit
    - _Requirements: 4.1–4.2, 6.8–6.9_

- [ ] 15. Shared hooks and infrastructure
  - [ ] 15.1 Create `src/hooks/useCountdownTicker.ts`: a single `setInterval` at 1 Hz that publishes elapsed time to a React context; `ExpiryCountdown` components subscribe to this context rather than each running their own timer
    - _Requirements: 2.5, 4.5_
  - [ ] 15.2 Create `src/lib/profileCache.ts`: a module-level `Map<string, PublicProfile>` keyed by UID; `getProfile(uid)` returns cached value or fetches from `publicProfiles/{uid}` and caches; used by `MessageItem` to avoid one Firestore read per message per render
    - _Requirements: 5.1–5.3_
  - [ ] 15.3 Create `src/hooks/useMessages.ts`: wraps `onSnapshot` on `rooms/{roomId}/messages`; merges optimistic messages with real messages using `messageId` as key; cancels subscription on unmount
    - _Requirements: 6.2–6.3_
  - [ ] 15.4 Create `src/hooks/useExpiryCountdown.ts`: subscribes to the shared ticker context from Task 15.1; derives `{ remainingMs, isExpired }` from `openedAt` without its own `setInterval`
    - _Requirements: 2.5, 4.5_

- [ ] 16. PWA, theme, and deploy
  - [ ] 16.1 Add `public/manifest.json` (name: "Volubly", short_name: "Volubly", display: "standalone", background_color: "#111", theme_color: "#22c55e"); add icon placeholders; register a service worker via `vite-plugin-pwa` or a hand-written `sw.js`
    - _Requirements: (project prerequisite)_
  - [ ] 16.2 Set Tailwind dark mode to `class`; add a `dark` class to `<html>` in `index.html`; verify minimum 12 px font and 44 px touch targets on key interactive elements
    - _Requirements: (project prerequisite)_
  - [ ] 16.3 Add `firebase.json` hosting config (public: `dist`, rewrites all to `index.html`); document deploy steps (`firebase deploy --only firestore:rules,firestore:indexes,hosting`) in `README.md`
    - _Requirements: (project prerequisite)_
  - [ ] 16.4 Enable Firestore TTL policies in the Firebase console (document steps in `docs/build-log.md`): set `expiresAt` as the TTL field for collection groups `rooms`, `messages`, `participants`, `rateLimits`
    - _Requirements: 2.6_

- [ ] 17. Checkpoint — All tests pass
  - Run `npm test` (unit tests) and `npm run test:emulator` (emulator tests). Confirm everything is green. Stop and ask the user if any test is red.

- [ ] 18. Start build log
  - [ ] 18.1 Create `docs/build-log.md` with an initial entry: date, Node version, Firebase CLI version, emulator JAR version, result of the day-1 spike (whether on-device AI ran, whether the SDK reports which path ran), and the TTL policy steps from Task 16.4
    - _Requirements: (documentation)_

## Notes

- Property-based tests (Tasks 3, 8) are **required** and must not be skipped.
- Every negative property in Task 3 includes a matching valid case that asserts `assertSucceeds`.
- `PROBATION_DURATION_S = 3600` (1 hour). Import this constant everywhere; never hardcode the value.
- `expiresAt` is never read in Security Rules enforcement. Any rule checking `expiresAt` for open/closed logic is a bug.
- `busiest` uses a Firestore `orderBy('openedAt','desc')` query and sorts client-side by `postingParticipantCount`.
- `preCheckSend` receives `userCreatedAt: Date` and derives probation client-side from it.
- `handlePermissionDenied` accepts an injected `readFn` so it can be unit-tested without a Firestore connection.
- `expiresAt` on room creation is set to `now + 25 h` (`Timestamp.fromMillis(Date.now() + 90_000_000)`), which is within the rules window of 24–26 h.
- All files must be written as UTF-8 without BOM.
- Checkpoints at Tasks 4, 17 gate forward progress.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.1"] },
    { "id": 1, "tasks": ["0.2", "0.3"] },
    { "id": 2, "tasks": ["1.1"] },
    { "id": 3, "tasks": ["2.1"] },
    { "id": 4, "tasks": ["2.2", "2.3"] },
    { "id": 5, "tasks": ["3.1","3.2","3.3","3.4","3.5","3.6","3.7","3.8","3.9","3.10","3.11","3.12","3.13","3.14","3.15","3.16","3.17"] },
    { "id": 6, "tasks": ["5.1", "6.1", "6.2"] },
    { "id": 7, "tasks": ["7.1","7.2","7.3","7.4","7.5","7.6","7.7","7.8"] },
    { "id": 8, "tasks": ["7.9","7.10"] },
    { "id": 9, "tasks": ["8.1","8.2","8.3","9.1","9.2","10.1"] },
    { "id": 10, "tasks": ["9.3","10.2"] },
    { "id": 11, "tasks": ["11.1"] },
    { "id": 12, "tasks": ["11.2","11.3","12.1","12.2","12.3","15.1","15.2"] },
    { "id": 13, "tasks": ["12.4","13.1","14.1","14.2","15.3","15.4"] },
    { "id": 14, "tasks": ["14.3","14.4"] },
    { "id": 15, "tasks": ["14.5"] },
    { "id": 16, "tasks": ["16.1","16.2","16.3","16.4","18.1"] }
  ]
}
```