# Requirements Document

## Introduction

A whisper thread is a private chat between exactly two people. One person (the inviter) invites another (the invitee). Nothing is in effect until the invitee accepts. A pending invite can be accepted for 15 minutes after it is created. Once accepted, the thread is open for exactly 1 hour from the acceptance time, then it closes. Either person can end it early, and the invitee can decline a pending invite. Either person can block the other, and a person who has blocked someone cannot be invited by them.

All of this is enforced only in `firestore.rules`. There are no Cloud Functions, and the project stays on the Spark plan. This spec covers rules, emulator tests and documentation only. Nothing under `src/` changes; the client is built separately.

Three limits of this design are stated up front:

- **The age band is self-declared.** The rules pair people only when their stored age bands match. A person can enter a false age at sign-up, so this is best-effort protection, not a guarantee.
- **The open-whisper cap limits spam, not a hard guarantee.** Anonymous accounts can be recreated, and a recreated account gets new slots.
- **Whisper threads are not end-to-end encrypted.** Messages are stored in Firestore. The honest claim is: only the two people can read a thread through the app; it is not end-to-end encrypted.

Time in the rules comes from `request.time`. Rules cannot count documents, so the cap uses slot documents written in the same batch, the same technique as `roomSlots` in the room-limit spec.

## Glossary

- **Rules_Engine**: The Firestore security rules in `firestore.rules`.
- **Whisper**: A document at `whispers/{whisperId}`.
- **Inviter**: The user in `inviterId`. **Invitee**: The user in `inviteeId`. **Member**: Either of the two.
- **Member_Ids**: The `memberIds` array, exactly `[inviterId, inviteeId]`.
- **Status**: One of `requested`, `accepted`, `declined`, `ended`.
- **Pending_Invite**: A Whisper with status `requested` and `request.time < createdAt + 15 minutes`.
- **Stale_Invite**: A Whisper with status `requested` and `request.time >= createdAt + 15 minutes`. It cannot be accepted.
- **Open_Thread**: A Whisper with status `accepted`, `acceptedAt` set, and `request.time < acceptedAt + 1 hour`.
- **Closed_Thread**: A Whisper with status `declined` or `ended`, or status `accepted` with `request.time >= acceptedAt + 1 hour`.
- **Whisper_Message**: A document at `whispers/{whisperId}/messages/{messageId}`.
- **Whisper_Rate_Limit**: A document at `whispers/{whisperId}/rateLimits/{uid}`.
- **Block_Entry**: A document at `users/{uid}/blocked/{otherUid}`. The blocker is `uid`.
- **Whisper_Slot**: A document at `whisperSlots/{uid}_{n}` with n from 1 to 3.
- **Open_Whisper**: For the cap, a Whisper that is a Pending_Invite or an Open_Thread.
- **Age_Band**: `users/{uid}.ageBandLabel`, one of `under_13`, `13_17`, `18_plus`. Self-declared.
- **Probation**: The first hour of an account, derived from `users/{uid}.createdAt`.
- **Expires_At_Hint**: The `expiresAt` field on Whispers, messages and slots. It is used only by Firestore TTL cleanup. The Rules_Engine never trusts it for an access decision.
- **Rules_Test_Suite**: The Vitest, fast-check and `@firebase/rules-unit-testing` tests in `tests/rules`, run with `npm run test:emulator`.
- **Admin_Context**: The rules-bypassing context from `adminDb()` in `tests/rules/helpers.ts`, used to plant backdated documents.

## Requirements

### Requirement 1: Inviting

**User Story:** As a person, I want to invite one other person to a private thread, so that we can talk without a room.

#### Acceptance Criteria

1. WHEN an authenticated user creates a Whisper with the user as `inviterId`, a different `inviteeId`, `memberIds` equal to `[inviterId, inviteeId]`, status `requested`, `createdAt == request.time`, `acceptedAt == null`, `endedBy == null`, `inviteeSlot == null`, an `inviterSlot` of 1, 2 or 3, and an `expiresAt` timestamp, THE Rules_Engine SHALL allow the create, subject to Requirements 2, 3 and 5.
2. IF a Whisper create contains any field other than `inviterId`, `inviteeId`, `memberIds`, `status`, `createdAt`, `acceptedAt`, `endedBy`, `inviterSlot`, `inviteeSlot` and `expiresAt`, or lacks any of them, THEN THE Rules_Engine SHALL deny it.
3. IF a Whisper create has an `inviterId` that is not `request.auth.uid`, or an `inviteeId` equal to `inviterId`, THEN THE Rules_Engine SHALL deny it.
4. IF a Whisper create has a status other than `requested`, a non-null `acceptedAt` or `endedBy`, or a `createdAt` that is not `request.time`, THEN THE Rules_Engine SHALL deny it.
5. IF the invitee has no `users` document, or the inviter has no `users` document, THEN THE Rules_Engine SHALL deny the create.
6. IF an unauthenticated client writes to any whisper path, THEN THE Rules_Engine SHALL deny the write.
7. THE Rules_Engine SHALL treat `expiresAt` on a Whisper only as the Expires_At_Hint, and SHALL require it to be a timestamp no earlier than `request.time + 1 hour 15 minutes` and no later than `request.time + 2 hours` at create time, so that a TTL cleanup cannot delete a live thread early.

### Requirement 2: Age-band matching

**User Story:** As a teen, I want to be paired only with people who declared the same age band, so that adults and minors are not paired by this feature.

#### Acceptance Criteria

1. WHEN a Whisper is created, THE Rules_Engine SHALL read the Age_Band of both the inviter and the invitee, and SHALL allow the create only when the two are equal and are `13_17` or `18_plus`.
2. IF either person has Age_Band `under_13`, THEN THE Rules_Engine SHALL deny the create and the accept, including when both are `under_13`.
3. IF the Age_Bands differ at invite time, THEN THE Rules_Engine SHALL deny the create.
4. WHEN the invitee accepts, THE Rules_Engine SHALL read both Age_Bands again and SHALL allow the accept only when they are equal and are `13_17` or `18_plus`.
5. IF the Age_Bands differ at accept time, for example because a users document differs from what was read at invite time, THEN THE Rules_Engine SHALL deny the accept and leave the Whisper unchanged.
6. THE Rules_Engine SHALL leave `users/{uid}.ageBandLabel` unchangeable by clients, as in the existing rules, so that a band cannot be switched between invite and accept.
7. THE spec documents, the build log entry and `safety-and-claims.md` SHALL state that the age band is self-declared and that this check is best-effort protection, not a guarantee.

### Requirement 3: Blocks

**User Story:** As a person, I want to block someone privately, so that they cannot start a thread with me.

#### Acceptance Criteria

1. WHEN a user reads, lists, creates, updates or deletes a Block_Entry under `users/{uid}/blocked/{otherUid}` where `uid == request.auth.uid`, THE Rules_Engine SHALL allow it, subject to criterion 2.
2. THE Rules_Engine SHALL require a Block_Entry to have exactly the fields `blockedId` (equal to the document ID, a string, not equal to `uid`) and `blockedAt` (equal to `request.time`).
3. IF any other user, or an unauthenticated client, reads, lists or writes a Block_Entry, THEN THE Rules_Engine SHALL deny it. Blocks are private, including to the blocked person.
4. WHEN a user deletes their own Block_Entry, THE Rules_Engine SHALL allow it, so that a person can unblock.
5. IF the invitee has a Block_Entry for the inviter, THEN THE Rules_Engine SHALL deny the Whisper create from that inviter.
6. IF the inviter has a Block_Entry for the invitee, THEN THE Rules_Engine SHALL deny the create as well, so that a person cannot invite someone they have blocked.
7. WHEN the invitee accepts, THE Rules_Engine SHALL check again that neither Member has blocked the other (both `users/{inviter}/blocked/{invitee}` and `users/{invitee}/blocked/{inviter}`), and SHALL deny the accept if either exists.
8. IF the other Member has a Block_Entry for the sender (`users/{other}/blocked/{sender}` exists), THEN THE Rules_Engine SHALL deny a Whisper_Message create by the sender. Only that direction is checked: the blocker MAY still send. The client also ends the thread when it creates a block, but the rules are the enforcement.
9. THE Rules_Engine SHALL NOT reveal a block or an age mismatch through the error or through any readable document. A denied invite, accept or message appears as a plain permission-denied result, and the design SHALL NOT add cause-specific error behaviour. The client shows a generic error.

### Requirement 4: Accepting, declining and ending

**User Story:** As a person, I want clear control over a thread, so that I can accept, decline or end it.

#### Acceptance Criteria

1. WHEN the invitee updates a Whisper from status `requested` to `accepted` with `acceptedAt == request.time` and an `inviteeSlot` of 1, 2 or 3, while the Whisper is a Pending_Invite, THE Rules_Engine SHALL allow the update, subject to Requirements 2, 3 and 5.
2. IF the inviter, or anyone who is not the invitee, tries to accept a Whisper, THEN THE Rules_Engine SHALL deny it.
3. IF a Stale_Invite is accepted, THEN THE Rules_Engine SHALL deny it. The Rules_Engine SHALL use `createdAt + 15 minutes` for this and SHALL NOT use `expiresAt`.
4. IF an accept sets `acceptedAt` to anything other than `request.time`, or a client-supplied timestamp, THEN THE Rules_Engine SHALL deny it.
5. WHEN the invitee updates a Whisper from `requested` to `declined`, THE Rules_Engine SHALL allow it. The decline MAY happen on a Stale_Invite, because declining frees nothing but is harmless.
6. IF the inviter tries to set status `declined`, THEN THE Rules_Engine SHALL deny it. The inviter ends a pending invite with `ended` instead (criterion 7).
7. WHEN either Member updates an `accepted` Whisper to `ended` with `endedBy == request.auth.uid`, THE Rules_Engine SHALL allow it, including after the hour has passed (so that a slot can be freed and the record is tidy). WHEN the inviter updates a `requested` Whisper to `ended` with `endedBy == request.auth.uid`, THE Rules_Engine SHALL allow it.
8. THE Rules_Engine SHALL allow only these transitions: `requested` to `accepted` (invitee), `requested` to `declined` (invitee), `requested` to `ended` (inviter), `accepted` to `ended` (either Member). Every other transition SHALL be denied, including any transition out of `declined` or `ended`.
9. IF an update changes any field other than the ones its transition sets, THEN THE Rules_Engine SHALL deny it. Accept sets exactly `status`, `acceptedAt` and `inviteeSlot`. Decline sets exactly `status`. End and cancel set exactly `status` and `endedBy`. `inviterId`, `inviteeId`, `memberIds`, `createdAt`, `inviterSlot` and `expiresAt` SHALL never change, and `inviteeSlot` SHALL change only once, from null at accept.
10. THE Rules_Engine SHALL deny every client delete of a Whisper, a Whisper_Message, a Whisper_Rate_Limit and a Whisper_Slot.
11. THE Rules_Engine SHALL use `request.time` for every status-change timestamp and SHALL NOT accept a client clock.

### Requirement 5: Open-whisper cap with slots

**User Story:** As a platform maintainer, I want each person limited to 3 open whispers, so that one account cannot flood others with invites.

#### Acceptance Criteria

1. THE Rules_Engine SHALL use slot documents `whisperSlots/{uid}_{n}` with n equal to 1, 2 or 3, and SHALL allow a write to a slot only when the document ID is the requesting user's own uid followed by `_1`, `_2` or `_3`.
2. A Whisper_Slot SHALL contain exactly `userId`, `whisperId`, `openedAt` and `expiresAt`. `userId` SHALL equal `request.auth.uid`, `whisperId` SHALL be a non-empty string, and `openedAt` SHALL equal `request.time`. `expiresAt` is an Expires_At_Hint and SHALL be a timestamp, but SHALL NOT be used for any allow decision.
3. WHEN a Whisper is created, THE Rules_Engine SHALL allow it only when the same batch also writes the slot `whisperSlots/{inviterId}_{inviterSlot}`, named by the Whisper's own `inviterSlot` field so that exactly one slot is checked, verified with `existsAfter` and `getAfter`, whose `whisperId` equals the new Whisper's ID, whose `userId` equals the inviter, and whose `openedAt` equals the Whisper's `createdAt`.
4. WHEN the invitee accepts, THE Rules_Engine SHALL allow it only when the same batch also writes the slot `whisperSlots/{inviteeId}_{inviteeSlot}`, named by the `inviteeSlot` set in that accept and matched the same way, so that an accepted thread counts toward both members and a pending invite counts only toward the inviter. This choice is made so that a pending invite cannot be forced into the invitee's slots by the inviter. It is recorded as a decision for review.
5. THE Rules_Engine SHALL allow a slot create when no document exists at that slot ID, and SHALL allow a slot update only when the previous Whisper is over, meaning the Whisper referenced by the stored `whisperId` is `declined` or `ended`, or is `requested` and stale (`request.time >= createdAt + 15 minutes`), or is `accepted` and `request.time >= acceptedAt + 1 hour`. The new `whisperId` SHALL differ from the stored one. WHERE the stored Whisper no longer exists (for example after TTL cleanup), THE Rules_Engine SHALL treat the slot as reusable.
6. IF all three slots of the user exist and none is reusable, THEN THE Rules_Engine SHALL deny a new invite from that user, and no Whisper or slot SHALL be written.
7. THE Rules_Engine SHALL decide slot reuse from the previous Whisper's own fields and SHALL NOT use `expiresAt`.
8. THE Rules_Engine SHALL deny a slot write that is not paired in the same batch with the Whisper create or accept it belongs to, and SHALL require each create or accept to be matched by its own slot, so that one slot cannot satisfy two writes.
9. THE Rules_Engine SHALL allow a user to `get` their own slot and to `list` slots restricted to `userId == request.auth.uid`, and SHALL deny every other read of a slot.
10. THE spec documents, the build log entry and `safety-and-claims.md` SHALL describe the cap with the exact phrase "limits spam, not a hard guarantee" and SHALL state that anonymous accounts can be recreated and a recreated account gets new slots.

### Requirement 6: Access control and reads

**User Story:** As a person, I want only me and the other person to be able to read the thread.

#### Acceptance Criteria

1. WHEN a Member does a `get` on a Whisper, THE Rules_Engine SHALL allow it.
2. IF any other authenticated user, or an unauthenticated client, does a `get` or `list` on a Whisper, THEN THE Rules_Engine SHALL deny it.
3. WHEN a Member lists the `whispers` collection with a query that includes `memberIds array-contains request.auth.uid`, THE Rules_Engine SHALL allow it and return only that user's threads. A query without that constraint SHALL be denied as a whole.
4. WHEN a Member reads a Whisper_Message while the Whisper is an Open_Thread, THE Rules_Engine SHALL allow the read.
5. IF a Member reads a Whisper_Message while the Whisper is a Closed_Thread, a Pending_Invite, or a Stale_Invite, THEN THE Rules_Engine SHALL deny the read. Messages are unreadable after the hour and after either person ends the thread.
6. THE Rules_Engine SHALL keep the Whisper document itself readable to both Members after it closes, so that the client can show that the thread ended. The Whisper document holds no message content.
7. IF a non-member reads, lists, creates, updates or deletes any document under `whispers/{id}` (the Whisper, its messages, its rate limits), THEN THE Rules_Engine SHALL deny it.
8. THE spec documents, the build log entry and `safety-and-claims.md` SHALL state that only the two people can read a thread through the app, and that it is not end-to-end encrypted. They SHALL NOT claim end-to-end encryption, "private from everyone", "zero logs" or "safe for children".

### Requirement 7: Whisper messages

**User Story:** As a person in an open thread, I want to send short messages, with the same protections as rooms.

#### Acceptance Criteria

1. WHEN a Member creates a Whisper_Message in an Open_Thread, THE Rules_Engine SHALL allow it, subject to criteria 2 to 8.
2. THE Rules_Engine SHALL require exactly the fields `messageId`, `senderId`, `body`, `sentAt`, `whisperId` and `expiresAt`.
3. THE Rules_Engine SHALL require `senderId == request.auth.uid`, `messageId == the document ID`, `whisperId == the parent ID`, `sentAt == request.time`, and `body` to be a string of 1 to 280 characters.
4. IF the Whisper is a Pending_Invite, a Stale_Invite, `declined`, `ended`, or accepted with `request.time >= acceptedAt + 1 hour`, THEN THE Rules_Engine SHALL deny the message. The window SHALL be computed from `acceptedAt + 1 hour` and SHALL NOT use `expiresAt`.
5. IF the sender is not a Member, THEN THE Rules_Engine SHALL deny the message.
6. THE Rules_Engine SHALL require the same-batch write of `whispers/{id}/rateLimits/{uid}` with `lastMessageAt == request.time` (checked with `getAfter`), and SHALL deny the message when an existing rate limit document has `lastMessageAt` within the last 3 seconds. The pattern is the one used by `rooms/{roomId}/rateLimits/{userId}`.
7. THE Rules_Engine SHALL allow a Whisper_Rate_Limit create or update only by its own `uid`, only in an Open_Thread, with exactly `userId`, `lastMessageAt` (equal to `request.time`) and `expiresAt` (unchanged on update).
8. WHILE the sender is in Probation, THE Rules_Engine SHALL deny a message whose body contains `http://`, `https://` or `www.` in any letter case, and SHALL allow the same body without a link. Probation is derived from `users/{uid}.createdAt` and is one hour.
9. THE Rules_Engine SHALL deny every client update and delete of a Whisper_Message.
10. THE Rules_Engine SHALL treat `expiresAt` on a message only as the Expires_At_Hint. It SHALL require it to be a timestamp but SHALL NOT use it to decide whether the message is allowed. For a message, a rate limit and a slot, it SHALL equal the parent Whisper's `expiresAt`, which is a copy and not a decision input.
11. IF the other Member has blocked the sender, THEN THE Rules_Engine SHALL deny the message, as defined in Requirement 3.8.

### Requirement 8: Rules-lookup budget

**User Story:** As a maintainer, I want every rule to stay inside the Firestore lookup limits, so that valid writes are not rejected at runtime.

#### Acceptance Criteria

1. THE Rules_Engine SHALL use no more than 10 document lookups (`get`, `getAfter`, `exists`, `existsAfter`) in the evaluation of any single-document operation.
2. THE Rules_Engine SHALL use no more than 20 document lookups in the evaluation of a batch, counting across every document in the batch.
3. THE design SHALL include a lookup count per operation, and SHALL state which functions are called once and cached by a `let` binding.
4. THE Rules_Test_Suite SHALL include a worst-case test for the invite batch (Whisper create plus inviter slot, with the slot being a reuse of an over thread, with block checks and both age bands read) that succeeds.
5. THE Rules_Test_Suite SHALL include a worst-case test for the first message in a thread (the message plus the first rate limit create, in a probation account with a clean body) that succeeds.
6. THE Whisper SHALL carry `inviterSlot` (set at invite) and `inviteeSlot` (set at accept) so that the rules check exactly one slot per write instead of trying slots 1, 2 and 3 in turn, which can cost 6 lookups. The design SHALL record this as an adjustment with its reason.
7. IF the fallback of copying `inviterBand` onto the Whisper is ever used, THEN THE Rules_Engine SHALL enforce at create that `inviterBand` equals the inviter's `users` document `ageBandLabel`, and SHALL NOT trust a client-supplied band.
8. THE design SHALL contain a lookup-count table for the invite batch, accept batch, first message, later message, end, decline and cancel, counting the slot write inside each batch, and SHALL confirm each stays within 10 per operation and 20 per batch.

### Requirement 9: Rules tests

**User Story:** As a developer, I want emulator tests that show every rule denies the bad case and allows the matching good case.

#### Acceptance Criteria

1. THE Rules_Test_Suite SHALL start every test from empty data (`clearData()`, then seed with the Admin_Context), and SHALL leave no data visible to the next test.
2. THE Rules_Test_Suite SHALL include, for every denial test, a positive control that differs from the denied case only in the condition under test, and that succeeds.
3. THE Rules_Test_Suite SHALL include example tests for: invite allowed; invite across age bands denied; invite to someone who blocked me denied; invite to someone I blocked denied; fourth open whisper denied; accept by the invitee allowed, by anyone else denied; accept after 15 minutes denied; accept across age bands denied; message in an accepted thread allowed; message by a non-member denied; message denied when the other member has blocked the sender, with the blocker still able to send in the same thread; message before acceptance denied; message after one hour denied; message after either person ended it denied; link in probation denied and normal text allowed; second message within 3 seconds denied; non-member read denied; member read allowed; read of messages after close denied; block entry readable only by its owner; delete of any whisper data denied; accept denied when either member has blocked the other; inviter cancels a pending invite allowed, with the invitee setting `ended` on a pending invite denied; every transition out of `declined` or `ended` denied; a slot reusable after decline, after cancel and after the hour, and not reusable while the thread is open; unblock by the owner allowed, with another user deleting a block entry denied; a slot write not paired with a Whisper create or accept (alone, or in a decline or end batch) denied; accept where the written slot does not match `inviteeSlot` denied; a slot whose `expiresAt` differs from the Whisper's denied; a create with `expiresAt` below +1h15m or above +2h denied; a create with a non-null `inviteeSlot`, or an `inviterSlot` of 0 or 4, denied; one slot unable to satisfy two Whisper creates in the same batch.
4. THE Rules_Test_Suite SHALL plant backdated Whispers, slots, rate limits and users documents through the Admin_Context for every expiry case, because request.time cannot be moved in the emulator, and SHALL avoid the exact boundary instant.
5. THE Rules_Test_Suite SHALL include these fast-check properties, each required and not optional: (1) a message is never accepted outside the one-hour window, whatever the timing; (2) users in different age bands can never be paired, whatever the order of invite and accept; (3) no non-member can read or write any whisper data; (4) a person can never hold more than 3 open whispers.
6. THE fast-check properties that run against the emulator SHALL use `numRuns` of 20 or fewer.
7. THE Rules_Test_Suite SHALL obtain Firestore contexts only from `tests/rules/helpers.ts`. Where more than two authenticated users are needed, a new helper MAY be added to that file, and the existing helpers SHALL NOT change behaviour.
8. THE existing room, rooms-and-expiry and room-limit tests SHALL still pass. `npm run test:emulator` SHALL run all rules test files serially, with `fileParallelism` false as already configured.
9. THE new tests SHALL be in new files under `tests/rules` and SHALL NOT edit the existing test files.

### Requirement 10: Honest documentation

**User Story:** As a reader and reviewer, I want the feature described at its real strength.

#### Acceptance Criteria

1. THE spec documents, the build log entry and `.kiro/steering/safety-and-claims.md` SHALL each use the phrase "age band is self-declared" and the phrase "limits spam, not a hard guarantee".
2. `.kiro/steering/safety-and-claims.md` SHALL gain one bullet for whisper threads, stating what the rules do and do not do, and SHALL keep the existing bullets unchanged.
3. THE documents SHALL NOT claim end-to-end encryption, "private from everyone", "zero logs", "safe for children" or "child-safe", and SHALL NOT describe the age check or the cap as unbypassable or a guarantee.
4. `docs/build-log.md` SHALL gain a short entry describing what Kiro generated for this spec, and SHALL state that enforcement is in `firestore.rules` only and that no Cloud Functions are used.
5. THE design SHALL explain every adjustment to the data model listed in the goal, with the reason.

### Requirement 11: Scope and file hygiene

**User Story:** As a maintainer, I want the work confined to rules, tests and docs.

#### Acceptance Criteria

1. THE implementation SHALL modify only `firestore.rules`, new files under `tests/rules`, `tests/rules/helpers.ts` (additive helpers only), `docs/build-log.md`, `.kiro/steering/safety-and-claims.md`, `.kiro/specs/whisper-threads/*`, and one new file under `.kiro/hooks`. `firestore.indexes.json` MAY change only if the design shows a query that needs a composite index.
2. THE implementation SHALL leave every file under `src/` unchanged.
3. THE implementation SHALL keep every existing rule for `rooms`, `roomSlots`, `users` and `publicProfiles` working as before. The only change to an existing `match` block SHALL be the new `blocked` subcollection under `users/{userId}`.
4. THE implementation SHALL save `firestore.rules` as plain UTF-8 without a byte order mark, and SHALL verify this by reading the first three bytes of the file after every write.
5. THE implementation SHALL add an agent hook in `.kiro/hooks` that runs `npm run test:emulator` whenever `firestore.rules` or any file under `tests/rules` is saved.
6. THE Rules_Engine SHALL use only Firestore security rules, with no Cloud Functions and no paid-plan feature.

## Decisions recorded after review

1. **Invitee slot timing (5.4).** A pending invite uses only the inviter's slot. The invitee's slot is written in the accept batch. Accepted.
2. **Inviter cancel (4.7).** The inviter can move `requested` to `ended`. Accepted.
3. **Blocks stop messages (3.8).** Changed from the first draft: a message is denied when the other member has blocked the sender, one direction only. The client also ends the thread on a block.
4. **Cleanup hint bounds (1.7).** Accepted.
5. **Slot fields on the Whisper (8.6).** `inviterSlot` and `inviteeSlot` added to keep the lookup count low.
6. **Accept checks both block directions (3.7).** Changed from the first draft.
