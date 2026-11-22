# Implementation Plan: whisper-threads

## Overview

A whisper thread is a private chat between exactly two people, open for one hour after the invitee accepts. Everything is enforced in `firestore.rules` only. There are no Cloud Functions and the project stays on the Spark plan. The age band is self-declared, so pairing people by band is best-effort protection, not a guarantee. The open-whisper cap limits spam, not a hard guarantee: anonymous accounts can be recreated, and a recreated account gets new slots. Threads are not end-to-end encrypted. Only the two people can read a thread through the app.

Work is limited to `firestore.rules`, files under `tests/rules`, `docs/build-log.md`, `.kiro/steering/safety-and-claims.md`, this spec folder, and (as the last task) one file in `.kiro/hooks`. Nothing under `src/` changes. Nothing is deployed: do not run `firebase deploy` or any command that writes to a real Firebase project. Tests run only against the local emulator with `npm run test:emulator`.

Order: test helpers, rules, example tests, worst-case budget tests, property tests, checkpoint, docs, scope check and final run, hook.

## Tasks

- [ ] 1. Add test helpers
  - [ ] 1.1 Add one additive helper to `tests/rules/helpers.ts`
    - Add `userDb(uid)` returning `env.authenticatedContext(uid).firestore()`, because the existing helpers only cover `userA` and `userB`. Do not change the behaviour of any existing export
    - The age band used by the rules comes from the seeded `users` documents, not from the auth token
    - _Requirements: 9.7, 11.1_

  - [ ] 1.2 Create `tests/rules/whisperHelpers.ts`
    - Export `inviteBatch(db, opts)`: a `writeBatch` with the Whisper create (`inviterId`, `inviteeId`, `memberIds`, `status: 'requested'`, `createdAt: serverTimestamp()`, `acceptedAt: null`, `endedBy: null`, `inviterSlot`, `inviteeSlot: null`, `expiresAt` of now plus 90 minutes) and the inviter slot (`userId`, `whisperId`, `openedAt: serverTimestamp()`, `expiresAt` equal to the Whisper's). Options: `whisperOverrides`, `slotOverrides`, `slotId`, `omitSlot`, `omitWhisper`. An override value of `undefined` removes that key
    - Export `acceptBatch(db, opts)`: updates the Whisper (`status: 'accepted'`, `acceptedAt: serverTimestamp()`, `inviteeSlot`) and writes the invitee slot. Options: `whisperOverrides`, `slotOverrides`, `slotId`, `omitSlot`
    - Export `messageBatch(db, opts)`: the message create plus the rate limit write (`lastMessageAt: serverTimestamp()`, `expiresAt` equal to the Whisper's). Options: `body`, `messageOverrides`, `omitRateLimit`
    - Export seeders that use the admin context with backdated times: `seedUser(admin, uid, { band, ageSeconds })` (default `18_plus`, 2 days old), `seedWhisper(admin, id, { inviterId, inviteeId, status, createdAgeS, acceptedAgeS?, endedBy?, inviterSlot, inviteeSlot? })` with `expiresAt` set to `createdAt` plus 90 minutes, `seedWhisperSlot(admin, uid, n, { whisperId, ageSeconds })`, `seedBlock(admin, blocker, blocked)`, `seedRateLimit(admin, whisperId, uid, ageSeconds)`
    - Export small constants for ages that avoid the exact boundaries: pending invite 14 minutes (valid) and 16 minutes (stale), open thread 30 and 59 minutes, over thread 61 minutes
    - Build only on the helpers in `tests/rules/helpers.ts`
    - _Requirements: 9.1, 9.4, 9.7_

- [ ] 2. Implement the rules in `firestore.rules`
  - [ ] 2.1 Add helper functions and the `blocked` subcollection
    - Read the current `firestore.rules` first and keep every existing rule and function unchanged
    - Add `wPath`, `uPath`, `blockPath`, `bandOf`, `bandsPair`, `isMember`, `isOpenThread`, `isPending`, `isOver` and `slotIdFor` as written in the design. `slotIdFor` uses a ternary and does not use `string(n)`
    - Add `match /blocked/{otherUid}` inside the existing `match /users/{userId}` block. Allow read, create and update only when `request.auth.uid == userId` and the data is exactly `blockedId` (equal to `otherUid`, a string, not equal to `userId`) and `blockedAt` (equal to `request.time`). Allow delete when `request.auth.uid == userId`. Everything else is denied
    - After the write, read the first three bytes of `firestore.rules` and confirm they are not `EF BB BF` (no byte order mark). Write the file as plain UTF-8 only
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 11.3, 11.4_

  - [ ] 2.2 Add the `whispers` match block with `get`, `list`, `create` and `delete`
    - `get` and `list`: `isAuthed() && isMember(resource.data)`
    - `create`: exact field set (`inviterId`, `inviteeId`, `memberIds`, `status`, `createdAt`, `acceptedAt`, `endedBy`, `inviterSlot`, `inviteeSlot`, `expiresAt`); `inviterId == request.auth.uid`; `inviteeId != inviterId`; `memberIds == [inviterId, inviteeId]`; `status == 'requested'`; `createdAt == request.time`; `acceptedAt == null`; `endedBy == null`; `inviteeSlot == null`; `inviterSlot in [1, 2, 3]`; `expiresAt` between `request.time + 1h15m` and `request.time + 2h`; `bandsPair(inviterId, inviteeId)`; neither `exists(blockPath(invitee, inviter))` nor `exists(blockPath(inviter, invitee))`; and the slot `slotIdFor(inviterId, inviterSlot)` is written in the same batch (`existsAfter` and `getAfter`, with `whisperId == whisperId`, `userId == request.auth.uid`, `openedAt == request.time`)
    - `delete`: `false`
    - Use `let` bindings so each lookup is called once per evaluation
    - Re-check that the file has no byte order mark
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 3.5, 3.6, 3.9, 4.10, 5.3, 6.1, 6.2, 6.3, 8.1, 8.2_

  - [ ] 2.3 Add the `whispers` `update` rule with the four transitions
    - accept: caller is `inviteeId`; `isPending(resource.data)`; `status` `requested` to `accepted`; `acceptedAt == request.time`; `inviteeSlot in [1, 2, 3]`; `affectedKeys().hasOnly(['status', 'acceptedAt', 'inviteeSlot'])`; `bandsPair(inviterId, inviteeId)`; neither block entry exists (both directions); the slot `slotIdFor(inviteeId, inviteeSlot)` is written in the same batch and matches (`whisperId`, `userId`, `openedAt == request.time`)
    - decline: caller is `inviteeId`; `requested` to `declined`; only `status` changes. A stale invite may be declined
    - cancel: caller is `inviterId`; `requested` to `ended`; `endedBy == request.auth.uid`; only `status` and `endedBy` change
    - end: caller is a member; `accepted` to `ended`; `endedBy == request.auth.uid`; only `status` and `endedBy` change. Allowed after the hour too
    - Every other transition is denied, including any out of `declined` or `ended`. `inviterId`, `inviteeId`, `memberIds`, `createdAt`, `inviterSlot` and `expiresAt` never change, and `inviteeSlot` changes only from null at accept
    - Decline, cancel and end read no other document
    - Re-check that the file has no byte order mark
    - _Requirements: 2.4, 2.5, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.11, 5.4, 8.1, 8.2_

  - [ ] 2.4 Add the `whisperSlots` match block
    - `get`: the slot ID is the caller's own (`uid_1`, `uid_2` or `uid_3`). `list`: `resource.data.userId == request.auth.uid`. `delete`: `false`
    - `create`: own slot ID, exact fields (`userId`, `whisperId`, `openedAt`, `expiresAt`), `userId == request.auth.uid`, `whisperId` a non-empty string, `openedAt == request.time`, and the slot is for a Whisper written in this batch: `existsAfter(whisper)` and `getAfter(whisper).data` shows either the caller as inviter with `slotId == slotIdFor(uid, inviterSlot)` and `createdAt == request.time`, or the caller as invitee with `slotId == slotIdFor(uid, inviteeSlot)` and `acceptedAt == request.time`. In both cases `slot.expiresAt == whisper.expiresAt`
    - `update`: all of the create conditions, plus a new `whisperId` that differs from the stored one, plus the previous Whisper is over: `!exists(prev) || isOver(get(prev).data)`. Do not use the slot's own `expiresAt` for this decision
    - Re-check that the file has no byte order mark
    - _Requirements: 5.1, 5.2, 5.5, 5.7, 5.8, 5.9, 4.10_

  - [ ] 2.5 Add the `messages` and `rateLimits` subcollections under `whispers`
    - messages `read`: `isAuthed()`, `isMember(parent)` and `isOpenThread(parent)`, using one `get` of the parent
    - messages `create`: member, open thread, `senderId == request.auth.uid`, exact fields (`messageId`, `senderId`, `body`, `sentAt`, `whisperId`, `expiresAt`), `messageId == messageId` (the document ID), `whisperId == whisperId` (the parent ID), `body` a string of 1 to 280 characters, `sentAt == request.time`, `expiresAt == parent.expiresAt`, the other member has not blocked the sender (`!exists(blockPath(other, request.auth.uid))`, where `other` is the member who is not the sender), the 3 second rate limit with the same `getAfter`, `exists`, `get` pattern as `rooms/{roomId}/rateLimits/{userId}`, and `!isInProbation() || hasNoUrl(body)`. `update` and `delete`: `false`
    - rateLimits `create` and `update`: `request.auth.uid == userId`, the parent is an open thread and the caller is a member, exact fields (`userId`, `lastMessageAt`, `expiresAt`), `lastMessageAt == request.time`, `expiresAt` equal to the parent's (create) or to the stored value (update). `read`: the owner. `delete`: `false`
    - Re-check that the file has no byte order mark
    - _Requirements: 3.8, 6.4, 6.5, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11_

- [ ] 3. Write example tests
  - [ ] 3.1 Invite tests in `tests/rules/whisperInvite.test.ts`
    - Set up with `clearData()` in `beforeEach`, seed `users` documents with `seedUser`, and `afterAll(teardown)`. Use only helpers from `tests/rules/helpers.ts` and `whisperHelpers.ts`. Every test starts from empty data
    - Invite allowed (same band, free slot). Control for each denial below is the same batch with the single condition fixed:
    - invite across age bands denied (control: same band `13_17`, and same band `18_plus`); `under_13` with `under_13` denied; invite to someone who blocked the inviter denied; invite to someone the inviter blocked denied (control: no block); unauthenticated denied; slot ID of another user denied
    - a create with a non-null `inviteeSlot` denied (control: null); `inviterSlot` 0 denied and 4 denied (control: 1, 2 or 3)
    - a create with `expiresAt` below `+1h15m` (for example +1h) denied and above `+2h` (for example +3h) denied (control: +90 minutes)
    - `acceptedAt` or `endedBy` set at create denied; `createdAt` not `request.time` denied; extra or missing field denied; `inviteeId == inviterId` denied; `memberIds` in the wrong order or with a third uid denied (control: correct)
    - fourth open whisper denied: three slots held by open whispers (pending 14 minutes old, accepted 30 minutes old, accepted 59 minutes old). Control: the same user with only two held slots succeeds in the third slot
    - Check through `adminDb` that a denied batch wrote no Whisper and no slot
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 3.5, 3.6, 5.3, 5.6, 9.1, 9.2, 9.3, 9.4_

  - [ ] 3.2 Accept, decline, cancel and end tests in `tests/rules/whisperTransitions.test.ts`
    - accept by the invitee allowed (control) and by the inviter or a third person denied; accept 14 minutes after create allowed and 16 minutes denied; accept across bands denied (plant the two `users` documents with different bands, control: same bands); accept denied when either member has blocked the other, tested for both directions (control: no block); `acceptedAt` not `request.time` denied; accept by an invitee who holds three open whispers denied (control: two)
    - accept where the slot written does not match `inviteeSlot` denied: for example `inviteeSlot` 1 with the write to `uid_2` (control: `inviteeSlot` 1 with `uid_1`). Also an accept with no slot write denied
    - inviter cancels a pending invite (`requested` to `ended`, `endedBy` set) allowed; the invitee setting `ended` on a pending invite denied; the inviter setting `declined` denied; the invitee setting `declined` allowed, including on a stale invite
    - every transition out of `declined` denied and every transition out of `ended` denied (control: `accepted` to `ended` by either member allowed, tested once for each member); `accepted` to `requested` and `accepted` to `declined` denied
    - immutability: a change of `inviterId`, `inviteeId`, `memberIds`, `createdAt`, `inviterSlot`, `expiresAt` or `endedBy` outside its transition denied; `inviteeSlot` changed after accept denied (control: the allowed transition)
    - delete of a Whisper denied (control: the same member can still read it, checked through `adminDb`)
    - A decline, cancel or end batch that also writes a slot is denied (see 3.3)
    - _Requirements: 2.4, 2.5, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 5.4, 9.1, 9.2, 9.3, 9.4_

  - [ ] 3.3 Slot tests in `tests/rules/whisperSlots.test.ts`
    - a slot write not paired with a Whisper create or accept is denied, alone and inside a decline batch and inside an end batch (control: the same slot written in a valid invite batch)
    - a slot whose `expiresAt` differs from the Whisper's `expiresAt` denied (control: equal); slot with a wrong field set, `openedAt` not `request.time`, `userId` of another user, or an empty `whisperId` denied (control: valid)
    - one slot cannot satisfy two Whisper creates in the same batch: two Whisper creates with `inviterSlot` 1 and a single `uid_1` write is denied, nothing is written (control: two creates with `inviterSlot` 1 and 2 and two slot writes succeeds)
    - a slot reusable after decline, after cancel, after a stale invite (16 minutes) and after the hour (accepted 61 minutes ago), and when the previous Whisper no longer exists; and NOT reusable while the previous thread is open: pending 14 minutes old, and accepted 30 minutes old. Each denial is paired with the matching reuse that succeeds
    - slot update that keeps the same `whisperId` denied; delete of an own slot denied and the slot still exists through `adminDb`; read of another person's slot denied (control: own slot read); list without `userId` filter denied (control: list with `where('userId', '==', uid)`); unauthenticated list denied
    - _Requirements: 4.10, 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8, 5.9, 7.10, 9.1, 9.2, 9.3, 9.4_

  - [ ] 3.4 Message tests in `tests/rules/whisperMessages.test.ts`
    - message in an accepted thread allowed (control), by a non-member denied, before acceptance denied (thread `requested`), 61 minutes after acceptance denied (control: 59 minutes), after the thread was ended by the sender denied, after it was ended by the other member denied (control: `accepted`)
    - message denied when the other member has blocked the sender (control: no block). The blocker sending in the same thread is allowed (this is the positive control for the line above)
    - link in probation denied for `http://`, `https://` and `www.` in any letter case (control: the same text without a link). A link from an account past probation allowed
    - second message within 3 seconds denied (plant a rate limit 1 second old; control: planted 10 seconds old)
    - body empty, 281 characters, wrong `senderId`, wrong `messageId`, wrong `whisperId`, wrong `sentAt` or extra field denied (control: a 280 character body)
    - message update and delete denied; `expiresAt` that differs from the Whisper's denied (control: equal)
    - rate limit write by another user denied; rate limit write when the thread is closed denied
    - _Requirements: 3.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 9.1, 9.2, 9.3, 9.4_

  - [ ] 3.5 Read, list and block tests in `tests/rules/whisperAccess.test.ts`
    - member read of the Whisper allowed; non-member and unauthenticated read denied
    - member list with `where('memberIds', 'array-contains', uid)` allowed and returns only that member's threads; list without the filter denied; list with another user's uid denied
    - message read allowed while open; denied after one hour, after end, before accept and for a stale invite (control: open thread). Non-member message read denied
    - block entry readable, creatable, updatable and deletable only by its owner (unblock allowed); another user reading or deleting it denied; the blocked person reading it denied; a block entry with `blockedId` different from the document ID, with `blockedId` equal to the owner, or with an extra field denied (control: valid)
    - a denied invite caused by a block and a denied invite caused by an age mismatch both fail with permission-denied, with no difference visible to the caller
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 9.1, 9.2, 9.3_

- [ ] 4. Guard the rules lookup budget in `tests/rules/whisperBudget.test.ts`
  - [ ] 4.1 Write the two worst-case tests
    - Invite batch with slot reuse: plant the slot's previous Whisper as an ended thread, both `users` documents present, same band, no block entries. The batch must succeed. This is 10 counted lookups against the limit of 20 per batch
    - First message in a thread: the sender is in probation, the body has no link, the thread is accepted and open, no rate limit exists yet. The batch must succeed. This is 7 counted lookups
    - Also run the accept batch with slot reuse (10 counted lookups) and a later message (7 counted lookups) and assert both succeed
    - If any of these fails with a lookup-limit error, stop and ask the user before changing the design. The documented fallback is to copy `inviterBand` onto the Whisper. If that fallback is used, the create rule must enforce `inviterBand == get(users/{inviterId}).data.ageBandLabel` and must never trust a client-supplied band, with a denial test (wrong `inviterBand`) and a positive control (correct `inviterBand`)
    - Check the current Firestore documentation for the lookup limits and whether repeated access to the same document counts once, and note the finding in a comment
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [ ] 5. Write required property-based tests in `tests/rules/whisper.property.test.ts`
  - [ ] 5.1 Message window property
    - **Property 1: A message is never accepted outside the one-hour window**
    - Generate a thread status (`requested`, `accepted`, `declined`, `ended`) and an acceptance age. Plant the Whisper with the admin context. Ages avoid the exact boundary: open ages from 1 to 58 minutes, over ages from 62 minutes to 5 hours
    - Assert a message is accepted exactly when the status is `accepted` and the age is in the open range
    - Call `clearData()` at the start of each run. Set `numRuns` to 20 or fewer. This test is required
    - Tag: `Feature: whisper-threads, Property 1: message window`
    - _Requirements: 4.11, 7.4, 9.5, 9.6_

  - [ ] 5.2 Age pairing property
    - **Property 2: Users in different age bands can never be paired**
    - Generate two bands and an order of invite and accept. Include a case where the two `users` documents differ at accept time but matched at invite time
    - Assert a thread reaches `accepted` only when both bands are equal and not `under_13`. After each run, read through `adminDb` and assert no Whisper with differing bands has status `accepted`
    - Call `clearData()` at the start of each run. Set `numRuns` to 20 or fewer. This test is required
    - Tag: `Feature: whisper-threads, Property 2: age pairing`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 9.5, 9.6_

  - [ ] 5.3 Non-member access property
    - **Property 3: No non-member can read or write any whisper data**
    - Generate a Whisper status and a non-member uid (including an unauthenticated client). Try read, list, create, update and delete on the Whisper, its messages and its rate limits
    - Assert every attempt is denied and the stored data read through `adminDb` is unchanged
    - Call `clearData()` at the start of each run. Set `numRuns` to 20 or fewer. This test is required
    - Tag: `Feature: whisper-threads, Property 3: non-member access`
    - _Requirements: 6.2, 6.7, 9.5, 9.6_

  - [ ] 5.4 Open-whisper cap property
    - **Property 4: A person can never hold more than 3 open whispers**
    - Seed 0 to 3 slots as Open (pending 1 to 13 minutes old, or accepted 1 to 58 minutes old), Over (ended, declined, accepted 62 minutes or older) or Missing. Generate 1 to 5 invite attempts that each target slot 1, 2 or 3
    - Model: an attempt succeeds exactly when the target slot is Missing or Over, and a success makes it Open. After each attempt assert the emulator result equals the model, and that the count of open Whispers for the person read through `adminDb` is at most 3
    - Call `clearData()` at the start of each run. Set `numRuns` to 20 or fewer. This test is required
    - Tag: `Feature: whisper-threads, Property 4: open whisper cap`
    - _Requirements: 5.1, 5.3, 5.5, 5.6, 9.5, 9.6_

  - [ ] 5.5 Pure-model invariants without the emulator
    - In `tests/rules/whisperModel.test.ts`, check the same invariants for properties 1, 2 and 4 on a small TypeScript model of the rules, with fast-check and more runs than the emulator tests. This file does not need the emulator
    - Tag: `Feature: whisper-threads, model invariants`
    - _Requirements: 9.5_

- [ ] 6. Checkpoint - Rules and tests
  - Run `npm run test:emulator`, one command at a time, no watch mode. All new tests and all existing tests (smoke, room, room-limit) must pass. Run test files serially (`fileParallelism` false is already set)
  - If any test is red, stop and ask the user before changing anything beyond the failing test or rule
  - _Requirements: 9.8_

- [ ] 7. Documentation
  - [ ] 7.1 Append the whisper-threads entry to `docs/build-log.md`
    - Short entry on what Kiro generated for this spec: requirements, design, rules, test files and properties. State that enforcement is in `firestore.rules` only and no Cloud Functions are used, and that nothing was deployed
    - Include the exact phrases "age band is self-declared" and "limits spam, not a hard guarantee", and the caveat that anonymous accounts can be recreated and a recreated account gets new slots
    - Say that only the two people can read a thread through the app and that it is not end-to-end encrypted. Say the client is built separately and the real client is not updated by this spec
    - Do not claim end-to-end encryption, "private from everyone", "zero logs", "safe for children" or "child-safe", and do not describe the age check or the cap as unbypassable or a guarantee
    - _Requirements: 10.1, 10.3, 10.4_

  - [ ] 7.2 Add one bullet to `.kiro/steering/safety-and-claims.md`
    - Add a single whisper-threads bullet under the existing safety rules and leave every other line unchanged. It states: pairs only people with the same stored age band, and the age band is self-declared, so this is best-effort protection, not a guarantee; at most 3 open whispers per person, which limits spam, not a hard guarantee; blocks stop messages; only the two people can read a thread through the app; not end-to-end encrypted
    - _Requirements: 10.1, 10.2, 10.3_

- [ ] 8. Final checkpoint - Scope check and full run
  - [ ] 8.1 Verify scope with git
    - Run `git status --short` and `git diff --stat` and confirm the changed or new files are only `firestore.rules`, files under `tests/rules`, `docs/build-log.md`, `.kiro/steering/safety-and-claims.md` and `.kiro/specs/whisper-threads/`
    - Run `git diff --stat -- src` and confirm it prints nothing
    - Confirm `firestore.rules` has no byte order mark by reading its first three bytes
    - Search the spec files, `docs/build-log.md`, the steering file and `firestore.rules` for "end-to-end", "zero logs", "private from everyone", "child-safe", "safe for children", "unbypassable" and confirm each use is a denial ("not end-to-end encrypted") and none is a claim
    - Confirm nothing was deployed: no `firebase deploy` appears in the shell history of this work
    - _Requirements: 10.3, 11.1, 11.2, 11.3, 11.4, 11.6_

  - [ ] 8.2 Run both test suites
    - Run `npm run test:emulator` and `npm test` (single run, no watch mode). Both must be green, including every existing test
    - If anything is red, stop and ask the user
    - _Requirements: 9.8, 9.9_

- [ ] 9. Add the save hook (last task)
  - [ ] 9.1 Create the hook in `.kiro/hooks`
    - Do this only after tasks 1 to 8 are done, so the hook does not fire during implementation
    - Use the `createHook` tool (do not write the file by hand): trigger `PostFileSave`, matcher `firestore\.rules$|tests[\\/]rules[\\/]`, action type `command`, command `npm run test:emulator`
    - Confirm the file exists under `.kiro/hooks` and that its matcher covers `firestore.rules` and a file under `tests/rules`. Do not trigger a save to test it
    - _Requirements: 11.1, 11.5_

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
    { "id": 19, "tasks": ["9.1"] }
  ]
}
```
