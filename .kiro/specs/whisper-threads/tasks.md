# Implementation Plan: whisper-threads

## Overview

A whisper thread is a private chat between exactly two people, open for one hour after the invitee accepts. Everything is enforced in `firestore.rules` only. There are no Cloud Functions and the project stays on the Spark plan. The age band is self-declared, so pairing people by band is best-effort protection, not a guarantee. The open-whisper cap limits spam, not a hard guarantee: anonymous accounts can be recreated, and a recreated account gets new slots. Threads are not end-to-end encrypted. Only the two people can read a thread through the app.

Tasks 1 to 9 (Part 1) are limited to `firestore.rules`, files under `tests/rules`, `docs/build-log.md`, `.kiro/steering/safety-and-claims.md`, this spec folder, and (as the last task) one file in `.kiro/hooks`. Nothing under `src/` changes in Part 1. Tasks 10 to 18 (Part 2, the client) are described after task 9. Nothing is deployed: do not run `firebase deploy` or any command that writes to a real Firebase project. Tests run only against the local emulator with `npm run test:emulator`.

Order: test helpers, rules, example tests, worst-case budget tests, property tests, checkpoint, docs, scope check and final run, hook.

## Tasks

- [x] 1. Add test helpers
  - [x] 1.1 Add one additive helper to `tests/rules/helpers.ts`
    - Add `userDb(uid)` returning `env.authenticatedContext(uid).firestore()`, because the existing helpers only cover `userA` and `userB`. Do not change the behaviour of any existing export
    - The age band used by the rules comes from the seeded `users` documents, not from the auth token
    - _Requirements: 9.7, 11.1_

  - [x] 1.2 Create `tests/rules/whisperHelpers.ts`
    - Export `inviteBatch(db, opts)`: a `writeBatch` with the Whisper create (`inviterId`, `inviteeId`, `memberIds`, `status: 'requested'`, `createdAt: serverTimestamp()`, `acceptedAt: null`, `endedBy: null`, `inviterSlot`, `inviteeSlot: null`, `expiresAt` of now plus 90 minutes) and the inviter slot (`userId`, `whisperId`, `openedAt: serverTimestamp()`, `expiresAt` equal to the Whisper's). Options: `whisperOverrides`, `slotOverrides`, `slotId`, `omitSlot`, `omitWhisper`. An override value of `undefined` removes that key
    - Export `acceptBatch(db, opts)`: updates the Whisper (`status: 'accepted'`, `acceptedAt: serverTimestamp()`, `inviteeSlot`) and writes the invitee slot. Options: `whisperOverrides`, `slotOverrides`, `slotId`, `omitSlot`
    - Export `messageBatch(db, opts)`: the message create plus the rate limit write (`lastMessageAt: serverTimestamp()`, `expiresAt` equal to the Whisper's). Options: `body`, `messageOverrides`, `omitRateLimit`
    - Export seeders that use the admin context with backdated times: `seedUser(admin, uid, { band, ageSeconds })` (default `18_plus`, 2 days old), `seedWhisper(admin, id, { inviterId, inviteeId, status, createdAgeS, acceptedAgeS?, endedBy?, inviterSlot, inviteeSlot? })` with `expiresAt` set to `createdAt` plus 90 minutes, `seedWhisperSlot(admin, uid, n, { whisperId, ageSeconds })`, `seedBlock(admin, blocker, blocked)`, `seedRateLimit(admin, whisperId, uid, ageSeconds)`
    - Export small constants for ages that avoid the exact boundaries: pending invite 14 minutes (valid) and 16 minutes (stale), open thread 30 and 59 minutes, over thread 61 minutes
    - Build only on the helpers in `tests/rules/helpers.ts`
    - _Requirements: 9.1, 9.4, 9.7_

- [x] 2. Implement the rules in `firestore.rules`
  - [x] 2.1 Add helper functions and the `blocked` subcollection
    - Read the current `firestore.rules` first and keep every existing rule and function unchanged
    - Add `wPath`, `uPath`, `blockPath`, `bandOf`, `bandsPair`, `isMember`, `isOpenThread`, `isPending`, `isOver` and `slotIdFor` as written in the design. `slotIdFor` uses a ternary and does not use `string(n)`
    - Add `match /blocked/{otherUid}` inside the existing `match /users/{userId}` block. Allow read, create and update only when `request.auth.uid == userId` and the data is exactly `blockedId` (equal to `otherUid`, a string, not equal to `userId`) and `blockedAt` (equal to `request.time`). Allow delete when `request.auth.uid == userId`. Everything else is denied
    - After the write, read the first three bytes of `firestore.rules` and confirm they are not `EF BB BF` (no byte order mark). Write the file as plain UTF-8 only
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 11.3, 11.4_

  - [x] 2.2 Add the `whispers` match block with `get`, `list`, `create` and `delete`
    - `get` and `list`: `isAuthed() && isMember(resource.data)`
    - `create`: exact field set (`inviterId`, `inviteeId`, `memberIds`, `status`, `createdAt`, `acceptedAt`, `endedBy`, `inviterSlot`, `inviteeSlot`, `expiresAt`); `inviterId == request.auth.uid`; `inviteeId != inviterId`; `memberIds == [inviterId, inviteeId]`; `status == 'requested'`; `createdAt == request.time`; `acceptedAt == null`; `endedBy == null`; `inviteeSlot == null`; `inviterSlot in [1, 2, 3]`; `expiresAt` between `request.time + 1h15m` and `request.time + 2h`; `bandsPair(inviterId, inviteeId)`; neither `exists(blockPath(invitee, inviter))` nor `exists(blockPath(inviter, invitee))`; and the slot `slotIdFor(inviterId, inviterSlot)` is written in the same batch (`existsAfter` and `getAfter`, with `whisperId == whisperId`, `userId == request.auth.uid`, `openedAt == request.time`)
    - `delete`: `false`
    - Use `let` bindings so each lookup is called once per evaluation
    - Re-check that the file has no byte order mark
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 3.5, 3.6, 3.9, 4.10, 5.3, 6.1, 6.2, 6.3, 8.1, 8.2_

  - [x] 2.3 Add the `whispers` `update` rule with the four transitions
    - accept: caller is `inviteeId`; `isPending(resource.data)`; `status` `requested` to `accepted`; `acceptedAt == request.time`; `inviteeSlot in [1, 2, 3]`; `affectedKeys().hasOnly(['status', 'acceptedAt', 'inviteeSlot'])`; `bandsPair(inviterId, inviteeId)`; neither block entry exists (both directions); the slot `slotIdFor(inviteeId, inviteeSlot)` is written in the same batch and matches (`whisperId`, `userId`, `openedAt == request.time`)
    - decline: caller is `inviteeId`; `requested` to `declined`; only `status` changes. A stale invite may be declined
    - cancel: caller is `inviterId`; `requested` to `ended`; `endedBy == request.auth.uid`; only `status` and `endedBy` change
    - end: caller is a member; `accepted` to `ended`; `endedBy == request.auth.uid`; only `status` and `endedBy` change. Allowed after the hour too
    - Every other transition is denied, including any out of `declined` or `ended`. `inviterId`, `inviteeId`, `memberIds`, `createdAt`, `inviterSlot` and `expiresAt` never change, and `inviteeSlot` changes only from null at accept
    - Decline, cancel and end read no other document
    - Re-check that the file has no byte order mark
    - _Requirements: 2.4, 2.5, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.11, 5.4, 8.1, 8.2_

  - [x] 2.4 Add the `whisperSlots` match block
    - `get`: the slot ID is the caller's own (`uid_1`, `uid_2` or `uid_3`). `list`: `resource.data.userId == request.auth.uid`. `delete`: `false`
    - `create`: own slot ID, exact fields (`userId`, `whisperId`, `openedAt`, `expiresAt`), `userId == request.auth.uid`, `whisperId` a non-empty string, `openedAt == request.time`, and the slot is for a Whisper written in this batch: `existsAfter(whisper)` and `getAfter(whisper).data` shows either the caller as inviter with `slotId == slotIdFor(uid, inviterSlot)` and `createdAt == request.time`, or the caller as invitee with `slotId == slotIdFor(uid, inviteeSlot)` and `acceptedAt == request.time`. In both cases `slot.expiresAt == whisper.expiresAt`
    - `update`: all of the create conditions, plus a new `whisperId` that differs from the stored one, plus the previous Whisper is over: `!exists(prev) || isOver(get(prev).data)`. Do not use the slot's own `expiresAt` for this decision
    - Re-check that the file has no byte order mark
    - _Requirements: 5.1, 5.2, 5.5, 5.7, 5.8, 5.9, 4.10_

  - [x] 2.5 Add the `messages` and `rateLimits` subcollections under `whispers`
    - messages `read`: `isAuthed()`, `isMember(parent)` and `isOpenThread(parent)`, using one `get` of the parent
    - messages `create`: member, open thread, `senderId == request.auth.uid`, exact fields (`messageId`, `senderId`, `body`, `sentAt`, `whisperId`, `expiresAt`), `messageId == messageId` (the document ID), `whisperId == whisperId` (the parent ID), `body` a string of 1 to 280 characters, `sentAt == request.time`, `expiresAt == parent.expiresAt`, the other member has not blocked the sender (`!exists(blockPath(other, request.auth.uid))`, where `other` is the member who is not the sender), the 3 second rate limit with the same `getAfter`, `exists`, `get` pattern as `rooms/{roomId}/rateLimits/{userId}`, and `!isInProbation() || hasNoUrl(body)`. `update` and `delete`: `false`
    - rateLimits `create` and `update`: `request.auth.uid == userId`, the parent is an open thread and the caller is a member, exact fields (`userId`, `lastMessageAt`, `expiresAt`), `lastMessageAt == request.time`, `expiresAt` equal to the parent's (create) or to the stored value (update). `read`: the owner. `delete`: `false`
    - Re-check that the file has no byte order mark
    - _Requirements: 3.8, 6.4, 6.5, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11_

- [x] 3. Write example tests
  - [x] 3.1 Invite tests in `tests/rules/whisperInvite.test.ts`
    - Set up with `clearData()` in `beforeEach`, seed `users` documents with `seedUser`, and `afterAll(teardown)`. Use only helpers from `tests/rules/helpers.ts` and `whisperHelpers.ts`. Every test starts from empty data
    - Invite allowed (same band, free slot). Control for each denial below is the same batch with the single condition fixed:
    - invite across age bands denied (control: same band `13_17`, and same band `18_plus`); `under_13` with `under_13` denied; invite to someone who blocked the inviter denied; invite to someone the inviter blocked denied (control: no block); unauthenticated denied; slot ID of another user denied
    - a create with a non-null `inviteeSlot` denied (control: null); `inviterSlot` 0 denied and 4 denied (control: 1, 2 or 3)
    - a create with `expiresAt` below `+1h15m` (for example +1h) denied and above `+2h` (for example +3h) denied (control: +90 minutes)
    - `acceptedAt` or `endedBy` set at create denied; `createdAt` not `request.time` denied; extra or missing field denied; `inviteeId == inviterId` denied; `memberIds` in the wrong order or with a third uid denied (control: correct)
    - fourth open whisper denied: three slots held by open whispers (pending 14 minutes old, accepted 30 minutes old, accepted 59 minutes old). Control: the same user with only two held slots succeeds in the third slot
    - Check through `adminDb` that a denied batch wrote no Whisper and no slot
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 3.5, 3.6, 5.3, 5.6, 9.1, 9.2, 9.3, 9.4_

  - [x] 3.2 Accept, decline, cancel and end tests in `tests/rules/whisperTransitions.test.ts`
    - accept by the invitee allowed (control) and by the inviter or a third person denied; accept 14 minutes after create allowed and 16 minutes denied; accept across bands denied (plant the two `users` documents with different bands, control: same bands); accept denied when either member has blocked the other, tested for both directions (control: no block); `acceptedAt` not `request.time` denied; accept by an invitee who holds three open whispers denied (control: two)
    - accept where the slot written does not match `inviteeSlot` denied: for example `inviteeSlot` 1 with the write to `uid_2` (control: `inviteeSlot` 1 with `uid_1`). Also an accept with no slot write denied
    - inviter cancels a pending invite (`requested` to `ended`, `endedBy` set) allowed; the invitee setting `ended` on a pending invite denied; the inviter setting `declined` denied; the invitee setting `declined` allowed, including on a stale invite
    - every transition out of `declined` denied and every transition out of `ended` denied (control: `accepted` to `ended` by either member allowed, tested once for each member); `accepted` to `requested` and `accepted` to `declined` denied
    - immutability: a change of `inviterId`, `inviteeId`, `memberIds`, `createdAt`, `inviterSlot`, `expiresAt` or `endedBy` outside its transition denied; `inviteeSlot` changed after accept denied (control: the allowed transition)
    - delete of a Whisper denied (control: the same member can still read it, checked through `adminDb`)
    - A decline, cancel or end batch that also writes a slot is denied (see 3.3)
    - _Requirements: 2.4, 2.5, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 5.4, 9.1, 9.2, 9.3, 9.4_

  - [x] 3.3 Slot tests in `tests/rules/whisperSlots.test.ts`
    - a slot write not paired with a Whisper create or accept is denied, alone and inside a decline batch and inside an end batch (control: the same slot written in a valid invite batch)
    - a slot whose `expiresAt` differs from the Whisper's `expiresAt` denied (control: equal); slot with a wrong field set, `openedAt` not `request.time`, `userId` of another user, or an empty `whisperId` denied (control: valid)
    - one slot cannot satisfy two Whisper creates in the same batch: two Whisper creates with `inviterSlot` 1 and a single `uid_1` write is denied, nothing is written (control: two creates with `inviterSlot` 1 and 2 and two slot writes succeeds)
    - a slot reusable after decline, after cancel, after a stale invite (16 minutes) and after the hour (accepted 61 minutes ago), and when the previous Whisper no longer exists; and NOT reusable while the previous thread is open: pending 14 minutes old, and accepted 30 minutes old. Each denial is paired with the matching reuse that succeeds
    - slot update that keeps the same `whisperId` denied; delete of an own slot denied and the slot still exists through `adminDb`; read of another person's slot denied (control: own slot read); list without `userId` filter denied (control: list with `where('userId', '==', uid)`); unauthenticated list denied
    - _Requirements: 4.10, 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8, 5.9, 7.10, 9.1, 9.2, 9.3, 9.4_

  - [x] 3.4 Message tests in `tests/rules/whisperMessages.test.ts`
    - message in an accepted thread allowed (control), by a non-member denied, before acceptance denied (thread `requested`), 61 minutes after acceptance denied (control: 59 minutes), after the thread was ended by the sender denied, after it was ended by the other member denied (control: `accepted`)
    - message denied when the other member has blocked the sender (control: no block). The blocker sending in the same thread is allowed (this is the positive control for the line above)
    - link in probation denied for `http://`, `https://` and `www.` in any letter case (control: the same text without a link). A link from an account past probation allowed
    - second message within 3 seconds denied (plant a rate limit 1 second old; control: planted 10 seconds old)
    - body empty, 281 characters, wrong `senderId`, wrong `messageId`, wrong `whisperId`, wrong `sentAt` or extra field denied (control: a 280 character body)
    - message update and delete denied; `expiresAt` that differs from the Whisper's denied (control: equal)
    - rate limit write by another user denied; rate limit write when the thread is closed denied
    - _Requirements: 3.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 9.1, 9.2, 9.3, 9.4_

  - [x] 3.5 Read, list and block tests in `tests/rules/whisperAccess.test.ts`
    - member read of the Whisper allowed; non-member and unauthenticated read denied
    - member list with `where('memberIds', 'array-contains', uid)` allowed and returns only that member's threads; list without the filter denied; list with another user's uid denied
    - message read allowed while open; denied after one hour, after end, before accept and for a stale invite (control: open thread). Non-member message read denied
    - block entry readable, creatable, updatable and deletable only by its owner (unblock allowed); another user reading or deleting it denied; the blocked person reading it denied; a block entry with `blockedId` different from the document ID, with `blockedId` equal to the owner, or with an extra field denied (control: valid)
    - a denied invite caused by a block and a denied invite caused by an age mismatch both fail with permission-denied, with no difference visible to the caller
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 9.1, 9.2, 9.3_

- [x] 4. Guard the rules lookup budget in `tests/rules/whisperBudget.test.ts`
  - [x] 4.1 Write the two worst-case tests
    - Invite batch with slot reuse: plant the slot's previous Whisper as an ended thread, both `users` documents present, same band, no block entries. The batch must succeed. This is 10 counted lookups against the limit of 20 per batch
    - First message in a thread: the sender is in probation, the body has no link, the thread is accepted and open, no rate limit exists yet. The batch must succeed. This is 7 counted lookups
    - Also run the accept batch with slot reuse (10 counted lookups) and a later message (7 counted lookups) and assert both succeed
    - If any of these fails with a lookup-limit error, stop and ask the user before changing the design. The documented fallback is to copy `inviterBand` onto the Whisper. If that fallback is used, the create rule must enforce `inviterBand == get(users/{inviterId}).data.ageBandLabel` and must never trust a client-supplied band, with a denial test (wrong `inviterBand`) and a positive control (correct `inviterBand`)
    - Check the current Firestore documentation for the lookup limits and whether repeated access to the same document counts once, and note the finding in a comment
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [x] 5. Write required property-based tests in `tests/rules/whisper.property.test.ts`
  - [x] 5.1 Message window property
    - **Property 1: A message is never accepted outside the one-hour window**
    - Generate a thread status (`requested`, `accepted`, `declined`, `ended`) and an acceptance age. Plant the Whisper with the admin context. Ages avoid the exact boundary: open ages from 1 to 58 minutes, over ages from 62 minutes to 5 hours
    - Assert a message is accepted exactly when the status is `accepted` and the age is in the open range
    - Call `clearData()` at the start of each run. Set `numRuns` to 20 or fewer. This test is required
    - Tag: `Feature: whisper-threads, Property 1: message window`
    - _Requirements: 4.11, 7.4, 9.5, 9.6_

  - [x] 5.2 Age pairing property
    - **Property 2: Users in different age bands can never be paired**
    - Generate two bands and an order of invite and accept. Include a case where the two `users` documents differ at accept time but matched at invite time
    - Assert a thread reaches `accepted` only when both bands are equal and not `under_13`. After each run, read through `adminDb` and assert no Whisper with differing bands has status `accepted`
    - Call `clearData()` at the start of each run. Set `numRuns` to 20 or fewer. This test is required
    - Tag: `Feature: whisper-threads, Property 2: age pairing`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 9.5, 9.6_

  - [x] 5.3 Non-member access property
    - **Property 3: No non-member can read or write any whisper data**
    - Generate a Whisper status and a non-member uid (including an unauthenticated client). Try read, list, create, update and delete on the Whisper, its messages and its rate limits
    - Assert every attempt is denied and the stored data read through `adminDb` is unchanged
    - Call `clearData()` at the start of each run. Set `numRuns` to 20 or fewer. This test is required
    - Tag: `Feature: whisper-threads, Property 3: non-member access`
    - _Requirements: 6.2, 6.7, 9.5, 9.6_

  - [x] 5.4 Open-whisper cap property
    - **Property 4: A person can never hold more than 3 open whispers**
    - Seed 0 to 3 slots as Open (pending 1 to 13 minutes old, or accepted 1 to 58 minutes old), Over (ended, declined, accepted 62 minutes or older) or Missing. Generate 1 to 5 invite attempts that each target slot 1, 2 or 3
    - Model: an attempt succeeds exactly when the target slot is Missing or Over, and a success makes it Open. After each attempt assert the emulator result equals the model, and that the count of open Whispers for the person read through `adminDb` is at most 3
    - Call `clearData()` at the start of each run. Set `numRuns` to 20 or fewer. This test is required
    - Tag: `Feature: whisper-threads, Property 4: open whisper cap`
    - _Requirements: 5.1, 5.3, 5.5, 5.6, 9.5, 9.6_

  - [x] 5.5 Pure-model invariants without the emulator
    - In `tests/rules/whisperModel.test.ts`, check the same invariants for properties 1, 2 and 4 on a small TypeScript model of the rules, with fast-check and more runs than the emulator tests. This file does not need the emulator
    - Tag: `Feature: whisper-threads, model invariants`
    - _Requirements: 9.5_

- [x] 6. Checkpoint - Rules and tests
  - Run `npm run test:emulator`, one command at a time, no watch mode. All new tests and all existing tests (smoke, room, room-limit) must pass. Run test files serially (`fileParallelism` false is already set)
  - If any test is red, stop and ask the user before changing anything beyond the failing test or rule
  - _Requirements: 9.8_

- [x] 7. Documentation
  - [x] 7.1 Append the whisper-threads entry to `docs/build-log.md`
    - Short entry on what Kiro generated for this spec: requirements, design, rules, test files and properties. State that enforcement is in `firestore.rules` only and no Cloud Functions are used, and that nothing was deployed
    - Include the exact phrases "age band is self-declared" and "limits spam, not a hard guarantee", and the caveat that anonymous accounts can be recreated and a recreated account gets new slots
    - Say that only the two people can read a thread through the app and that it is not end-to-end encrypted. Say the client is built separately and the real client is not updated by this spec
    - Do not claim end-to-end encryption, "private from everyone", "zero logs", "safe for children" or "child-safe", and do not describe the age check or the cap as unbypassable or a guarantee
    - _Requirements: 10.1, 10.3, 10.4_

  - [x] 7.2 Add one bullet to `.kiro/steering/safety-and-claims.md`
    - Add a single whisper-threads bullet under the existing safety rules and leave every other line unchanged. It states: pairs only people with the same stored age band, and the age band is self-declared, so this is best-effort protection, not a guarantee; at most 3 open whispers per person, which limits spam, not a hard guarantee; blocks stop messages; only the two people can read a thread through the app; not end-to-end encrypted
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 8. Final checkpoint - Scope check and full run
  - [x] 8.1 Verify scope with git
    - Run `git status --short` and `git diff --stat` and confirm the changed or new files are only `firestore.rules`, files under `tests/rules`, `docs/build-log.md`, `.kiro/steering/safety-and-claims.md` and `.kiro/specs/whisper-threads/`
    - Run `git diff --stat -- src` and confirm it prints nothing
    - Confirm `firestore.rules` has no byte order mark by reading its first three bytes
    - Search the spec files, `docs/build-log.md`, the steering file and `firestore.rules` for "end-to-end", "zero logs", "private from everyone", "child-safe", "safe for children", "unbypassable" and confirm each use is a denial ("not end-to-end encrypted") and none is a claim
    - Confirm nothing was deployed: no `firebase deploy` appears in the shell history of this work
    - _Requirements: 10.3, 11.1, 11.2, 11.3, 11.4, 11.6_

  - [x] 8.2 Run both test suites
    - Run `npm run test:emulator` and `npm test` (single run, no watch mode). Both must be green, including every existing test
    - If anything is red, stop and ask the user
    - _Requirements: 9.8, 9.9_

- [x] 9. Add the save hook (last task)
  - [x] 9.1 Create the hook in `.kiro/hooks`
    - Do this only after tasks 1 to 8 are done, so the hook does not fire during implementation
    - Use the `createHook` tool (do not write the file by hand): trigger `PostFileSave`, matcher `firestore\.rules$|tests[\\/]rules[\\/]`, action type `command`, command `npm run test:emulator`
    - Confirm the file exists under `.kiro/hooks` and that its matcher covers `firestore.rules` and a file under `tests/rules`. Do not trigger a save to test it
    - _Requirements: 11.1, 11.5_

---

# Part 2: Client tasks

Tasks 1 to 9 (rules, tests, docs, hook) are finished. Tasks 10 to 18 build the client described in Requirements 12 to 24 and the "Part 2: Client design" section of `design.md`. **Do not start task 10 until the requirements and design for Part 2 have been reviewed.**

Rules for every task below:

- One git commit per top-level task, made after its checks pass. Commit message: `whisper-client: <short summary>`.
- After each task run, one command at a time: `npx tsc --noEmit -p tsconfig.app.json` and `npm test`. Both must pass, including every existing test. Tasks 13 and 18 also run `npm run test:emulator`.
- Do not change `firestore.rules`, `firestore.indexes.json`, `package.json` or any existing file under `tests/rules`. Add no dependency. Do not deploy.
- Change an existing `src/` file only where the task names it, and only additively.
- Tell the person about any deviation from this spec instead of working around it.
- Append one line to the "Whisper threads: client" section of `docs/build-log.md` (task 10 creates the section).
- Saving a file under `tests/rules` triggers the rules-test hook and runs the emulator. That is expected.
- If a check fails, stop and ask before changing anything beyond the failing code.

## Tasks

- [x] 10. Types, time and data mapping
  - [x] 10.1 Create `src/lib/whisperTypes.ts`
    - Constants `INVITE_WINDOW_MS`, `THREAD_MS`, `SLOT_MARGIN_MS`, `EXPIRES_HINT_MS`, `MAX_WHISPERS`; types `SlotNumber`, `WhisperStatus`, `WhisperView` as in the design. Type-only import of `Timestamp`; no runtime Firebase import
    - _Requirements: 12.1, 14.6, 15.2_

  - [x] 10.2 Create `src/lib/whisperTime.ts` and `src/lib/__tests__/whisperTime.test.ts`
    - `whisperPhase`, `inviteMsLeft`, `threadMsLeft`, `formatCountdown`, `formatInviteLeft`
    - Examples: each phase at 14 and 16 minutes and at 59 and 61 minutes, a missing `acceptedAt`, a pending `acceptedAt` of null on `accepted`
    - fast-check: exactly one phase holds for any view and time; `open` holds exactly when `accepted` and now is before `acceptedAt` plus 1 hour; `formatCountdown` never shows a negative and never increases as time passes
    - _Requirements: 17.2, 17.3, 23.2_

  - [x] 10.3 Create `src/lib/whisperData.ts` and `src/lib/__tests__/whisperData.test.ts`
    - `toWhisperView(id, data)` returns null when any field is missing or the wrong type, including a status outside the four values and a slot outside 1 to 3
    - fast-check: random objects never throw
    - _Requirements: 16.1, 17.1_

  - [x] 10.4 Start the build-log section and commit
    - Add the "Whisper threads: client" heading and the first line to `docs/build-log.md`
    - Run the checks and make the commit
    - _Requirements: 23.5, 23.6, 24.1_

- [x] 11. Inbox model and slot picking
  - [x] 11.1 Create `src/lib/whisperInbox.ts` and `src/lib/__tests__/whisperInbox.test.ts`
    - `buildInbox`, `pendingInviteCount`, `relationWith`, `endActionFor`, `canPickPerson`, `whispersAllowed` as in the design
    - Examples: the three sections and their order; declined, ended, expired and finished items are absent; the person's own sent invite is never in "Invites for you"; `relationWith` in both directions; `endActionFor` for every role and status; `canPickPerson` is false for a simulated sender (one-line test), for the viewer's own message and for an `under_13` viewer, and true for a real message from someone else; `whispersAllowed('under_13')` is false
    - fast-check: sections never contain an over whisper; ordering holds; counts match the invites section
    - _Requirements: 16.1, 16.2, 18.2, 23.2_

  - [x] 11.2 Create `src/lib/whisperSlots.ts` and `src/lib/__tests__/whisperSlots.test.ts`
    - `pickSlot(slots, whispers, nowMs)` as in the design, with the 60 second margin on `requested` and `accepted` only
    - Examples: no slot documents; a slot whose Whisper is missing from the list; each over state; each busy state; one second inside and outside the margin; tie-breaking
    - fast-check: never returns a busy slot; returns null exactly when all three are busy; prefers a never-used slot
    - _Requirements: 15.1, 15.2, 15.3, 23.2_

  - [x] 11.3 Run the checks, append the build-log line, commit

- [x] 12. Copy and errors
  - [x] 12.1 Create `src/lib/whisperCopy.ts`
    - Every user-facing string in the design's copy table, as constants or small functions of a name. No string contains the forbidden words
    - _Requirements: 20.1, 20.2, 21.5_

  - [x] 12.2 Create `src/lib/whisperErrors.ts` and tests for both files
    - `whisperErrorText`, `classifyAcceptFailure(reread, uid, nowMs)`, `classifyInviteFailure(reread, uid)`
    - Examples: accept re-read that is `accepted` with the viewer as invitee (`accepted`), stale (`invite_expired`), no longer `requested` (`invite_expired`), still pending (generic), missing (generic); invite re-read that is `requested` with the viewer as inviter (`sent`), `requested` with someone else as inviter, `accepted`, missing (all generic)
    - Two scans, matching whole words and ignoring case. Scan 1 covers every exported string in `whisperCopy`: none may contain delete, deleted, erase, encrypted, "private from", secure, safe, "100%" or bot (Requirement 21.5). Scan 2 covers only the error texts (the two specific ones and the generic one): none may contain block, blocked, age, band, adult, teen, teenager or minor (Requirement 20.4). The sheet note may say "age group" and the block result may say "blocked", because neither is an error text
    - Exactly two specific error texts exist
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 21.5, 23.2_

  - [x] 12.3 Run the checks, append the build-log line, commit

- [x] 13. Write plans, offline-safe commit, Firebase shell and the emulator contract test
  - [x] 13.1 Create `src/lib/whisperPlans.ts` and `src/lib/__tests__/whisperPlans.test.ts`
    - `SERVER_TIME`, `planInvite`, `planAccept`, `planDecline`, `planCancel`, `planEnd`, `planBlock`, `planUnblock`, `planMessage` exactly as in the design table. Type-only Firebase imports
    - Examples: each plan's paths and exact field names
    - fast-check: field sets equal the rules' allowed lists for each transition; the slot document's `expiresAt` equals its Whisper's; the slot id equals `{uid}_{n}` for the slot the Whisper names; a message plan always contains the rate-limit write; `planBlock` includes the right Whisper update for each role and status, and none for an over whisper
    - _Requirements: 14.6, 15.4, 15.6, 16.4, 16.6, 16.7, 18.2, 18.3, 19.5, 23.2_

  - [x] 13.2 Create `src/lib/whisperApply.ts` and `src/lib/whisperWrite.ts` with `src/lib/__tests__/whisperWrite.test.ts`
    - `applyPlan(db, plan)`: one `writeBatch(db)`, `SERVER_TIME` becomes `serverTimestamp()`, `set`, `update` and `delete` map to the batch calls, then `commit()`. It imports `firebase/firestore` only and MUST NOT import `./firebase`
    - `withTimeout(promise, ms)` and `runGuarded(apply, { online, timeoutMs })` returning `{ ok: true }` or `{ ok: false, code: 'generic' }`. Offline writes nothing. A commit that never settles gives `generic` after `WRITE_TIMEOUT_MS` (10 s). A commit that settles clears the timer. Inject `online` and the timer source so tests can use `vi.useFakeTimers()`
    - Tests: offline does not call `apply`; a never-settling `apply` gives `generic` after 10 s and not before; a resolved `apply` leaves no pending timer; a rejected `apply` gives `generic`. fast-check: any rejection or any delay of 10 s or more gives `generic`
    - _Requirements: 20.6, 20.7, 20.8, 23.5_

  - [x] 13.3 Create `src/lib/whisperApi.ts`
    - `commit(plan)` is `runGuarded(() => applyPlan(db, plan), { online: navigator.onLine, timeoutMs: WRITE_TIMEOUT_MS })`. Every action below goes through `commit`
    - `loadMySlots(uid)` (one `getDocs` on `whisperSlots` where `userId == uid`), `hasBlocked`, a bounded `readWhisper(id)` (a `getDoc` with the same timeout; permission-denied and missing both give null), and the actions `sendInvite`, `acceptInvite`, `declineInvite`, `cancelInvite`, `endWhisper`, `blockPerson`, `unblockPerson`, `sendWhisperMessage`
    - Each action returns `{ ok: true }` or `{ ok: false, code }` using `WhisperErrorCode`. `sendInvite`: after any failure, `readWhisper(id)` then `classifyInviteFailure`; `sent` gives `{ ok: true }`. `acceptInvite`: client-clock check, then `pickSlot`, then the plan; after any failure, `readWhisper(id)` then `classifyAcceptFailure`; `accepted` gives `{ ok: true }`. Console-log the raw error code only
    - Use `data({ serverTimestamps: 'estimate' })` in any read that builds a `WhisperView`
    - No test imports this file directly; its logic is in the pure modules. It is covered by task 13.4 and by the type check
    - _Requirements: 14.5, 14.6, 14.8, 15.1, 16.4, 16.5, 20.1, 20.2, 20.3, 20.5, 20.6, 20.7, 22.5_

  - [x] 13.4 Create `tests/rules/whisperClientPlans.test.ts`
    - Use the existing emulator helpers (`userDb`, `adminDb`, `clearData`) and the existing `whisperHelpers.ts` seeders. Run each plan through the client's real `applyPlan(db, plan)` imported from `src/lib/whisperApply.ts`. Do not write a second plan-to-batch conversion in the test
    - Expect: invite, accept (including slot reuse), decline, cancel, end, block plus end, unblock, first message and later message all succeed
    - Expect the wrong-slot, extra-field and missing-field variants of invite and accept to fail, each paired with the unmodified plan succeeding. Build the variants by editing the plan (an `Op[]`) before calling `applyPlan`
    - Run `npm run test:emulator` and show the full result to the person. If the contract test fails because the client plan is wrong, fix the plan. If it fails because the rules differ from the design, stop and ask
    - _Requirements: 20.8, 23.4, 23.6_

  - [x] 13.5 Run the checks (including `npm run test:emulator`, shown in full), append the build-log line, commit
- [x] 14. Subscriptions and clocks
  - [x] 14.1 Create `src/hooks/useSubscription.ts` and `src/hooks/__tests__/useSubscription.test.tsx`
    - As in the design: `open` returns the unsubscribe function, cleanup calls it once, a late emit after cleanup is ignored, `retry` re-opens, `null` gives `idle`
    - First confirm `jsdom` is installed (`package.json` lists `jsdom` 25.0.1, and `vitest.config.ts` sets `environment: 'jsdom'`). It is, so test with `react-dom/client` and `act` and a fake `open`: mount then unmount calls the unsubscribe once; changing `deps` unsubscribes the old one and opens a new one; an emit after unmount does not throw or change state. Do not add `jsdom` or `happy-dom`. If either were missing, test the plain core with a fake `open` that counts unsubscribes instead
    - _Requirements: 22.1, 22.2, 23.3_

  - [x] 14.2 Create `src/hooks/useWhispers.ts`, `useWhisper.ts` and `useWhisperMessages.ts`
    - Exactly the queries in the design. Every document read in all three hooks uses `data({ serverTimestamps: 'estimate' })` (search the three files after writing them and confirm no `.data()` call lacks it). `useWhispers(null)`, `useWhisper(null)` and `useWhisperMessages(id, false)` open nothing. `useWhisperMessages` maps permission-denied to the existing `closed` state and uses `toMessageView`
    - Every listener goes through `useSubscription`; no direct `onSnapshot` in a component or page
    - _Requirements: 12.5, 17.7, 22.1, 22.3, 22.4_

  - [x] 14.3 Create `src/hooks/useCountdown.ts`
    - `useCountdown(endMs)` ticking each second (cleared on unmount) and `useDeadline(endMs)` using one `setTimeout`, plus `visibilitychange` (on `document`) and `focus` (on `window`) listeners that re-check `deadlinePassed(endMs, Date.now())`. The timer and both listeners are removed on unmount, and the hook returns true at once when `endMs` has passed
    - Pure `deadlinePassed` in `whisperTime.ts` with a test: before, at and after the end, and monotone in time (fast-check)
    - _Requirements: 17.3, 17.4, 22.1_

  - [x] 14.4 Run the checks, append the build-log line, commit

- [x] 15. Shared-component integration
  - [x] 15.1 Create `src/lib/whisperTarget.ts` and `src/lib/__tests__/whisperTarget.test.ts`
    - `makeWhisperTarget({ whisper, uid, createdAtMs, onClosed })` returning `ComposerTarget` (type exported from `whisperTarget.ts` and imported by the composer). Pure `nearHourMark(whisper, nowMs)`: true when the clock is within 60 seconds before or after `acceptedAt + THREAD_MS`
    - When `send` fails and `nearHourMark` is true, call `onClosed()` and return `{ status: 'failed', code: 'room_closed' }` (shown as "This whisper has ended, so messages can no longer be sent."), not a generic error. Inject the send function and the clock so this can be tested without Firebase
    - Examples: empty, 281 characters, 2 seconds after the last send, a link in probation (and not outside it), a closed thread gives `room_closed`, `explain('room_closed')` gives the whisper text, every other code equals `explainSendError`; a failed send at 30 seconds before and 30 seconds after the hour calls `onClosed`; a failed send 5 minutes before the hour does not and gives the generic send error
    - fast-check: a body of 1 to 280 characters with no link, sent at least 3 seconds after the last one, inside the hour, gives no problem; `nearHourMark` is symmetric around the hour mark
    - _Requirements: 19.2, 19.6, 19.8, 23.2_

  - [x] 15.2 Make the three additive edits and add tests
    - `MessageItem.tsx`: optional `onNameClick`. Test with `renderToStaticMarkup`: no button without it, a button with `aria-label` and a 44px tap area class with it, none on the reader's own message
    - `MessageList.tsx`: optional `closedText`, `emptyText`, `onPickPerson` (and the viewer's band, so it can call `canPickPerson`). Test (with the firebase stub): defaults unchanged, custom texts shown, name buttons absent for simulated and own messages (a simulated message with `onPickPerson` set renders no name button)
    - `MessageComposer.tsx`: optional `target` (props as a union) with the three fallback branches from the design. Test: a room composer renders as before, and a target composer renders without room props. Existing `MessageItem` test must still pass unedited
    - After the tests, send one message in a room by hand if the environment allows, or say plainly that it was not run
    - _Requirements: 12.2, 12.3, 14.1, 14.2, 19.1, 19.2_

  - [x] 15.3 Run the checks, append the build-log line, commit

- [x] 16. Inbox screen, route and Home link
  - [x] 16.1 Create `InviteCard.tsx`, `WhisperRow.tsx` and `WhispersLink.tsx` with static-render tests
    - `InviteCard`: shows name, avatar, time left, Accept, Decline, Decline and block, all 44px, with its own busy and error state, and the error line has `role="alert"`
    - `WhisperRow`: open and waiting variants, link to `#whisper/{id}`, Cancel only on waiting
    - `WhispersLink`: nothing for `under_13`; a link to `#whispers`; the count and accessible name when above zero
    - _Requirements: 13.2, 13.3, 16.3, 16.4, 16.6, 16.7, 16.8, 21.2_

  - [x] 16.2 Create `src/pages/WhispersPage.tsx` with static-render tests for its view
    - Split the page into a wrapper that checks `whispersAllowed(session.ageBand)`, an inner container (hooks) and a presentational `WhispersView({ state, inbox, ... })` so the loading, error, empty and sections states can be rendered with plain props
    - An `under_13` session shows "Whispers aren't available for this account." and a link back. Test with `vi.mock('../../hooks/useWhispers')` that the hook is not called for that session and is called for a `13_17` session
    - Cancel and Decline and block are buttons inside the existing rows, with no new screen
    - Wire Accept, Decline, Decline and block and Cancel to `whisperApi`, show `whisperErrorText` on failure, open `#whisper/{id}` on a successful accept
    - _Requirements: 13.1, 13.3, 13.4, 16.1, 16.2, 16.4, 16.5, 16.9, 16.10, 21.4_

  - [x] 16.3 Edit `App.tsx` and `HomePage.tsx`
    - Add the `#whispers` route before the room branch and `<WhispersLink/>` in the Home header. No other change (the `#whisper/{id}` route comes in task 17.3)
    - _Requirements: 12.2, 13.1, 13.2_

  - [x] 16.4 Run the checks, append the build-log line, commit

- [x] 17. Whisper chat
  - [x] 17.1 Create `WhisperHeader.tsx` with static-render tests
    - Avatar, name, the countdown chip (`role="timer"`, `mm:ss left`), End and End and block with the inline confirm row, 44px buttons. The chip is a separate component using `useCountdown`
    - _Requirements: 17.2, 17.3, 18.1, 18.3, 21.2_

  - [x] 17.2 Create `src/pages/WhisperPage.tsx` with static-render tests for its views
    - A wrapper with the same `whispersAllowed` gate as the Inbox (an `under_13` session shows the notice and the whisper hooks are not called), then a container plus presentational views for each phase in the design: not available, invite as invitee, waiting as inviter, invite expired, ended, open
    - `OpenChat` as a separate component: `useDeadline`, `useWhisperMessages(id, true)`, `useMessageGuard`, `useGhostCheck`, `WhisperHeader`, `MessageList` (empty `held` map, whisper `closedText` and `emptyText`), `MessageComposer` with `makeWhisperTarget` and an `onClosed` that sets a `forcedEnd` flag, the wide-screen `GhostStatus`
    - Treat `closed` messages while the document still says open as ended, and treat `forcedEnd` as ended
    - Test that the open chat's markup contains the same cloud-consent line as the room composer ("Allow a cloud check when this device can't do it")
    - End and End and block call `endWhisper` and `blockPerson`; show `whisperErrorText` on failure
    - Test that the ended view contains no message text and no composer, and that the wording says "ends" and never "delete"
    - _Requirements: 17.1, 17.4, 17.5, 17.6, 17.7, 17.8, 18.2, 18.3, 18.4, 18.6, 18.7, 19.1, 19.3, 19.4, 19.7, 21.5_

  - [x] 17.3 Edit `App.tsx` to add the `#whisper/{id}` route, then run the checks, append the build-log line, commit
    - _Requirements: 13.1_

- [x] 18. Invite from a room, final checks and docs
  - [x] 18.1 Create `src/components/PersonSheet.tsx` with static-render tests
    - Pure `personSheetState` plus the view; states loading, ready, blocked (Unblock), existing (link), sending, sent, failed; the neutral age-group note; Escape and outside-tap close; whisper id created once per mount
    - Test that the blocked state renders an Unblock button and no Invite button, and that the ready state renders Invite and no Unblock
    - Unblock and the buttons are inside this sheet; no new screen
    - Wire Invite to `loadMySlots`, `pickSlot`, `sendInvite`, and Unblock to `unblockPerson`
    - _Requirements: 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 18.5_

  - [x] 18.2 Edit `RoomPage.tsx`
    - One `useState` for the person, `onPickPerson` passed to `MessageList` (which applies `canPickPerson`, so simulated and own messages and `under_13` viewers never open it), `<PersonSheet/>` rendered when set. No other change
    - _Requirements: 12.2, 14.1, 14.2_

  - [x] 18.3 Scope and wording check
    - `git diff --stat` against the branch start: confirm the only existing files changed are `App.tsx`, `HomePage.tsx`, `RoomPage.tsx`, `MessageItem.tsx`, `MessageList.tsx`, `MessageComposer.tsx`, plus docs, and that `firestore.rules`, `firestore.indexes.json`, `package.json` and the lock file are unchanged
    - Search `src` for `onSnapshot`: confirm every new use is inside `src/hooks` and goes through `useSubscription`
    - Search the new files for "delete", "end-to-end", "encrypted", "child-safe", "zero logs" and confirm no user-facing use
    - Search the new files for hard-coded colours (`#` hex values, `rgb(`) and confirm none
    - _Requirements: 12.2, 12.4, 21.1, 21.5, 22.1, 24.3_

  - [x] 18.4 Final runs and docs
    - Add one line to the README "Limitations, said plainly" list: ended whispers stay in the database until a TTL policy is set up (use "ends", never "deleted")
    - Run `npx tsc -b`, `npm run build`, `npm test` and `npm run test:emulator` and show the emulator result in full. All green, including every existing test
    - Finish the build-log section: what Kiro generated, that enforcement is only in `firestore.rules`, the client cannot see the other person's age band, the age band is self-declared, the cap limits spam, not a hard guarantee, threads are not end-to-end encrypted, nothing was deployed, and the manual checks that were and were not run
    - Give the person a short manual test script (two accounts, invite, accept, message, countdown, end, block, expiry) and say it needs the Part 1 rules deployed first, which this work does not do
    - Commit
    - _Requirements: 23.5, 23.6, 24.1, 24.2, 24.3_

## Notes

- Property tests (tasks 5.1 to 5.4) are required, not optional.
- `request.time` cannot be faked in the emulator. Expiry is tested with backdated documents planted through `adminDb`, and ages avoid the exact boundaries (for example 14 versus 16 minutes, 59 versus 61 minutes).
- A denied invite, accept or message must look like a plain permission-denied. Do not add cause-specific error behaviour in rules or tests.
- Every denial test has a positive control that differs only in the condition under test. Every test starts from empty data.
- Do not edit existing test files. Do not touch `src/`. Do not deploy.
- Run commands one at a time in PowerShell. Do not start dev servers or watchers.
- Wording: use "age band is self-declared" and "limits spam, not a hard guarantee". Do not claim end-to-end encryption, "private from everyone", "zero logs" or "safe for children".

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["2.3"] },
    { "id": 3, "tasks": ["2.4"] },
    { "id": 4, "tasks": ["2.5"] },
    { "id": 5, "tasks": ["3.1"] },
    { "id": 6, "tasks": ["3.2"] },
    { "id": 7, "tasks": ["3.3"] },
    { "id": 8, "tasks": ["3.4"] },
    { "id": 9, "tasks": ["3.5"] },
    { "id": 10, "tasks": ["4.1"] },
    { "id": 11, "tasks": ["5.1", "5.5"] },
    { "id": 12, "tasks": ["5.2"] },
    { "id": 13, "tasks": ["5.3"] },
    { "id": 14, "tasks": ["5.4"] },
    { "id": 15, "tasks": ["6"] },
    { "id": 16, "tasks": ["7.1", "7.2"] },
    { "id": 17, "tasks": ["8.1"] },
    { "id": 18, "tasks": ["8.2"] },
    { "id": 19, "tasks": ["9.1"] },
    { "id": 20, "tasks": ["10.1"] },
    { "id": 21, "tasks": ["10.2", "10.3"] },
    { "id": 22, "tasks": ["10.4"] },
    { "id": 23, "tasks": ["11.1", "11.2"] },
    { "id": 24, "tasks": ["11.3"] },
    { "id": 25, "tasks": ["12.1"] },
    { "id": 26, "tasks": ["12.2"] },
    { "id": 27, "tasks": ["12.3"] },
    { "id": 28, "tasks": ["13.1"] },
    { "id": 29, "tasks": ["13.2"] },
    { "id": 30, "tasks": ["13.3"] },
    { "id": 31, "tasks": ["13.4"] },
    { "id": 32, "tasks": ["13.5"] },
    { "id": 33, "tasks": ["14.1"] },
    { "id": 34, "tasks": ["14.2", "14.3"] },
    { "id": 35, "tasks": ["14.4"] },
    { "id": 36, "tasks": ["15.1"] },
    { "id": 37, "tasks": ["15.2"] },
    { "id": 38, "tasks": ["15.3"] },
    { "id": 39, "tasks": ["16.1"] },
    { "id": 40, "tasks": ["16.2"] },
    { "id": 41, "tasks": ["16.3"] },
    { "id": 42, "tasks": ["16.4"] },
    { "id": 43, "tasks": ["17.1"] },
    { "id": 44, "tasks": ["17.2"] },
    { "id": 45, "tasks": ["17.3"] },
    { "id": 46, "tasks": ["18.1"] },
    { "id": 47, "tasks": ["18.2"] },
    { "id": 48, "tasks": ["18.3"] },
    { "id": 49, "tasks": ["18.4"] }
  ]
}
```
