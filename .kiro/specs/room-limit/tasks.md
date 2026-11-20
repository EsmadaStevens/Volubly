# Implementation Plan: room-limit

## Overview

Each account can have at most 2 active rooms. The limit is enforced only in `firestore.rules`, using two slot documents per user (`roomSlots/{uid}_1` and `roomSlots/{uid}_2`). There are no Cloud Functions and the project stays on the Spark plan. The limit limits spam, not a hard guarantee: anonymous accounts can be recreated, and a recreated account gets new slots.

Work is limited to `firestore.rules`, files under `tests/rules`, and documentation. Order: test helpers, rules, example tests, property tests, worst-case batch test, checkpoint, docs, final checks. All tests are TypeScript (Vitest, fast-check, `@firebase/rules-unit-testing`) and run with `npm run test:emulator`.

## Tasks

- [x] 1. Add test helpers for room and slot batches
  - [x] 1.1 Create `tests/rules/roomLimitHelpers.ts`
    - Export `createRoomBatch(db, opts)` as specified in the design: builds a `writeBatch` with the room (`type`, `title`, `maturityLabel`, `categories`, `openedAt: serverTimestamp()`, `expiresAt` of now plus 25 hours, `createdBy`, `postingParticipantCount: 0`) and the slot (`userId`, `roomId`, `openedAt: serverTimestamp()`, `expiresAt` equal to the room's `expiresAt`)
    - Support the `roomOverrides`, `slotOverrides`, `omitSlot` and `omitRoom` options so tests can change exactly one condition
    - Export `seedSlot(admin, uid, n, { roomId?, ageSeconds })`, which writes a slot through the admin context with a backdated `openedAt` and `expiresAt` of `openedAt` plus 25 hours
    - Export `seedUser(admin, uid)`, which writes the `users/{uid}` document with an 18+ age band so `ageBand()` in the rules resolves
    - Build on the existing `userADb`, `userBDb`, `unauthDb`, `adminDb`, `clearData`, `getEnv` and `teardown` in `tests/rules/helpers.ts` and do not change that file
    - _Requirements: 6.12, 6.13, 8.1_

- [x] 2. Implement the slot rules in `firestore.rules`
  - [x] 2.1 Add slot helper functions and the `roomSlots` match block
    - Add `ownsSlotId`, `slotPath`, `slotMatchesNewRoom`, `slotIsForNewRoom`, `validSlotData` and `slotExpired` as written in the design, using `let` bindings to keep the document-access count low
    - Add `match /roomSlots/{slotId}` with: `get` by path owner, `list` only when `resource.data.userId == request.auth.uid`, `create` with owner id, valid data and a new room in the batch, `update` only for an expired slot with a different `roomId`, valid data and a new room in the batch, and `delete` always denied
    - Keep every existing rule unchanged
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.5, 2.7, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 8.3, 8.4, 8.5, 8.6_

  - [x] 2.2 Add the slot conjunct to the `rooms` create rule
    - Append `&& (slotMatchesNewRoom(request.auth.uid + '_1', roomId) || slotMatchesNewRoom(request.auth.uid + '_2', roomId))` after the existing create conditions
    - Confirm all existing room create checks from the rooms-and-expiry spec stay in force
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.8, 3.1, 3.2, 3.3, 3.4, 3.8_

- [x] 3. Write example tests in `tests/rules/roomLimit.test.ts`
  - [x] 3.1 Set up the test file and write the two-active-room limit tests
    - Use only `userADb`, `userBDb`, `unauthDb` and `adminDb` from `tests/rules/helpers.ts`, call `clearData()` in `beforeEach`, and seed `users/{uid}` with `seedUser`
    - Check existing tests in `tests/rules`. The existing smoke test must keep passing. Any existing test that creates a room through an authenticated context must switch to `createRoomBatch`
    - First room with `userA_1` succeeds. Second room with `userA_2` succeeds while `_1` is active
    - Third room with both slots active is denied, and `adminDb` reads confirm no room and no slot change exists. Positive control: backdate `_1` past 24 hours with `seedSlot` and the same batch succeeds
    - A slot with a recent `openedAt` and a past `expiresAt` still blocks a third room
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.8, 6.1, 6.2, 6.3, 6.4, 6.12, 6.13_

  - [x] 3.2 Write slot shape and id tests
    - **Property 1: Slot id and field shape**
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.7, 3.7, 5.4**
    - Denied: `userB_1` or `userA_3` written by userA, an extra, missing or renamed field, backdated or future `openedAt`, `expiresAt` different from the room's, empty or non-string `roomId`. Positive control for each: the same batch with the single condition fixed
    - Unauthenticated slot write is denied
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 3.7, 5.4, 6.1_

  - [x] 3.3 Write room and slot linkage tests
    - **Property 2: Room create requires a matching slot in the same batch**
    - **Property 3: A slot must reference a new room owned by the caller**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8**
    - Room without slot is denied. Positive control: the same room with its slot
    - Slot whose `roomId` is an existing room of userB is denied. Positive control: `roomId` is the new room in the batch
    - Two room creates with one slot are denied and nothing is written. Positive control: two rooms with two slots
    - A room create that breaks an existing room rule (for example a bad `expiresAt`) is still denied even with a valid slot
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 6.1, 6.5, 6.6_

  - [x] 3.4 Write slot immutability and reuse tests
    - **Property 5: Expired slot reuse only inside a room-create batch**
    - **Property 6: Slots are never deleted and unexpired slots are never updated**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
    - Delete of an own slot is denied and the slot still exists through `adminDb`
    - Update of an unexpired slot is denied. Positive control: update of an expired slot inside a room-create batch succeeds
    - Update of an expired slot outside a room-create batch is denied. Positive control: the same update inside the batch
    - Reuse with the old `roomId`, or with `openedAt` not equal to `request.time`, is denied. Positive control: new `roomId` and `serverTimestamp()`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 6.1, 6.8, 6.9_

  - [x] 3.5 Write slot privacy tests
    - **Property 7: Slot privacy**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.5, 5.6, 5.7**
    - userB get, userB write and unauthenticated get are denied. Positive control: userA get succeeds
    - List without a `userId` filter is denied. Positive control: list with `where('userId', '==', uid)` returns only that user's slots
    - Unauthenticated list is denied
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6, 5.7, 6.1, 6.7_

  - [x] 3.6 Write expiry-derivation tests
    - **Property 8: Expiry is derived only from openedAt**
    - **Validates: Requirements 3.5, 4.6, 8.4, 8.5, 8.6**
    - A slot with 23 hours of age is active and one with 24 hours plus 1 minute is expired. Avoid the exact 24-hour boundary because `request.time` cannot be faked
    - A slot with a recent `openedAt` and a past `expiresAt` is still active. A slot with an old `openedAt` and a future `expiresAt` is expired
    - A stored slot whose `openedAt` is missing or not a timestamp causes the dependent write to be denied
    - _Requirements: 3.5, 4.6, 8.4, 8.5, 8.6, 6.1_

- [x] 4. Write required property-based tests in `tests/rules/roomLimit.property.test.ts`
  - [x] 4.1 Write the limit model property test
    - **Property 4: At most two active slots per user**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6, 3.8, 6.10, 6.11**
    - Generate a state for slot 1 and slot 2, each Missing, Active (age 1 minute to 23 hours) or Expired (age 24 hours plus 1 minute to 48 hours), and seed with `seedSlot`
    - Generate 1 to 4 room-create attempts that each target slot 1 or 2. Model: an attempt succeeds exactly when the targeted slot is Missing or Expired, and a success makes it Active
    - After each attempt, assert the emulator result equals the model and the number of Active slots read through `adminDb` is at most 2
    - Call `clearData()` at the start of each run. Set `numRuns` to 20 or fewer. This test is required
    - Tag: `Feature: room-limit, Property 4: At most two active slots per user`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.8, 6.10, 6.11, 6.13_

  - [x] 4.2 Write the slot immutability property test
    - **Property 6: Slots are never deleted and unexpired slots are never updated**
    - **Validates: Requirements 4.1, 4.2, 6.10, 6.11**
    - Seed an Active slot. Generate random mutations: change, drop or add a field, random timestamps (past, future, near `openedAt`) and random `roomId` values
    - Assert every client update and every delete is denied and the stored slot read through `adminDb` equals the seeded one
    - Call `clearData()` at the start of each run. Set `numRuns` to 20 or fewer. This test is required
    - Tag: `Feature: room-limit, Property 6: Slots are never deleted and unexpired slots are never updated`
    - _Requirements: 4.1, 4.2, 6.10, 6.11, 6.13_

- [x] 5. Guard the rules access-call budget
  - [x] 5.1 Write the worst-case valid batch test in `tests/rules/roomLimit.test.ts`
    - Seed `users/{uid}` and an active slot `userA_1`, then create a room that targets `userA_2` in one batch. The batch must succeed
    - This is the worst-case path for `slotMatchesNewRoom` (the `_1` check fails and `_2` is evaluated) with the user document read. If it fails with `permission-denied`, reduce `getAfter` repeats with `let` bindings in `firestore.rules`
    - Verify the current Firestore documentation for the access-call limits and whether duplicate accesses count once, and note the finding in a comment in the test
    - _Requirements: 2.1, 2.3, 2.4, 3.2, 6.2_

- [x] 6. Checkpoint - Rules and tests
  - Run `npm run test:emulator`. If any test is red, stop and ask the user before changing anything beyond the failing test or rule.

- [x] 7. Add the build-log entry
  - [x] 7.1 Append the room-limit entry to `docs/build-log.md`
    - Use the build-log entry text from the design. It must contain the exact phrase "limits spam, not a hard guarantee", the caveat that anonymous accounts can be recreated and a recreated account gets new slots, and a statement that enforcement is in `firestore.rules` only and no Cloud Functions are used
    - Add a line that the real client `createRoom` is denied by the new rules until the user updates it, and that this is expected
    - Do not claim the limit is unbypassable, complete or a hard guarantee
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.1_

- [x] 8. Verify the steering bullet
  - [x] 8.1 Check `.kiro/steering/safety-and-claims.md` for the room-limit bullet
    - Search the file with `Select-String -Path .kiro/steering/safety-and-claims.md -Pattern "limits spam, not a hard guarantee"` and confirm the bullet exists with the anonymous-account caveat. It was added earlier, so do not add it again
    - Only if the bullet is missing, report it to the user instead of editing
    - Search the spec files, `docs/build-log.md` and `firestore.rules` for the words unbypassable, complete and hard guarantee, and confirm none claims the limit is unbypassable, complete or a hard guarantee (the one allowed use is the exact phrase "limits spam, not a hard guarantee")
    - _Requirements: 7.1, 7.2, 7.4_

- [x] 9. Final checkpoint - Full test run and scope check
  - [x] 9.1 Verify scope with git
    - Run `git diff --stat` and `git status --short` and confirm the changed files are only `firestore.rules`, files under `tests/rules`, `docs/build-log.md` and spec or steering files
    - Run `git diff --stat -- src` and confirm it prints nothing, so no file under `src` changed and `createRoom` is untouched
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 9.2 Run both test suites
    - Run `npm run test:emulator` and `npm test` (single run, no watch mode). Both must be green, including the existing smoke test and every other existing test
    - If anything is red, stop and ask the user
    - _Requirements: 6.1, 6.10, 6.13_

## Notes

- The existing smoke test and every other existing test in `tests/rules` must keep passing. Any existing test that creates a room through an authenticated context must switch to `createRoomBatch`.
- The real client `createRoom` in `src` is denied by the new rules until the user updates it to write the room and a slot in one batch. This is expected and out of scope. No task touches `src`.
- Property tests (tasks 4.1 and 4.2) are required, not optional. Properties 1, 2, 3, 5, 7 and 8 are covered by example tests. Property 9 is checked by the git diff in task 9.1.
- `request.time` cannot be faked in the emulator. Expiry is tested by seeding slots with a backdated `openedAt` through `adminDb`, and generated ages avoid the exact 24-hour boundary.
- The limit limits spam, not a hard guarantee. Do not use stronger wording in tests, comments or docs.
- Run commands one at a time in PowerShell. Do not start dev servers or watchers.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["2.2"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2"] },
    { "id": 4, "tasks": ["3.3"] },
    { "id": 5, "tasks": ["3.4"] },
    { "id": 6, "tasks": ["3.5"] },
    { "id": 7, "tasks": ["3.6"] },
    { "id": 8, "tasks": ["4.1", "5.1"] },
    { "id": 9, "tasks": ["4.2"] },
    { "id": 10, "tasks": ["7.1", "8.1"] },
    { "id": 11, "tasks": ["9.1"] },
    { "id": 12, "tasks": ["9.2"] }
  ]
}
```
