# Requirements Document

## Introduction

A whisper thread is a private chat between exactly two people. One person (the inviter) invites another (the invitee). Nothing is in effect until the invitee accepts. A pending invite can be accepted for 15 minutes after it is created. Once accepted, the thread is open for exactly 1 hour from the acceptance time, then it closes. Either person can end it early, and the invitee can decline a pending invite. Either person can block the other, and a person who has blocked someone cannot be invited by them.

All of this is enforced only in `firestore.rules`. There are no Cloud Functions, and the project stays on the Spark plan. **Part 1 (Requirements 1 to 11)** covers rules, emulator tests and documentation only. Nothing under `src/` changes in Part 1. **Part 2 (Requirements 12 to 24, at the end of this file)** builds the client on top of the finished rules.

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
2. THE implementation of Part 1 SHALL leave every file under `src/` unchanged. (Part 2 changes `src/` only as listed in Requirement 12.)
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

---

# Part 2: Client

## Introduction (Part 2)

The rules and the emulator tests from Part 1 are finished. Part 2 adds the client: an invite button on a username in a room, a requests inbox, the whisper chat with its one-hour countdown, and end and block. Part 2 does not change `firestore.rules`. Every limit below is enforced by the rules; the client only explains problems early, and it must never be the only thing standing between a person and a rule.

Four facts shape the client:

- **The client cannot see the other person's age band.** `users/{uid}` is readable only by its owner. The rules refuse a cross-band invite, and the client can only show a generic failure. It must not guess or reveal a band.
- **Open listeners do not re-check rules.** A snapshot listener opened while a thread is open keeps delivering after the hour ends. The client must clear the thread itself.
- **The device clock can differ from the server clock.** The rules use `request.time`. The client uses its own clock for countdowns and early explanations, with a safety margin where a wrong guess would cause a denied write.
- **The Spark plan has no composite indexes and no Cloud Functions.** Whisper queries use one `array-contains`, and all sorting happens on the client.

## Glossary (Part 2)

- **Client**: The React app under `src/`.
- **Person_Sheet**: The dialog that opens when a person taps another person's username in a room.
- **Inbox**: The screen at `#whispers`.
- **Whisper_Chat**: The screen at `#whisper/{id}`.
- **Whisper_View**: The client's flat copy of a Whisper document (ids, status, times in milliseconds, slots, and the `expiresAt` timestamp kept as it came).
- **Thread_Phase**: A value derived from a Whisper_View and the current time: `invite_open`, `invite_expired`, `open`, `time_up`, `declined` or `ended`.
- **Slot_Pick**: The slot number (1, 2 or 3) the client chooses for an invite or an accept, or none when all three are busy.
- **Write_Plan**: A plain description of the writes for one action (a list of set, update and delete operations with a server-time marker). It holds no Firebase code, so it can be tested without Firebase and checked against the rules in the emulator.
- **Ghost_Pipeline**: The existing sender check (`useGhostCheck.review`, which redacts first and then asks the on-device or consented cloud model) and the existing reader check (`useMessageGuard`, which uses plain-code patterns and the on-device model only).
- **Shared_Components**: `MessageComposer`, `MessageList` and `MessageItem`.

## Requirements (Part 2)

### Requirement 12: Scope, integration points and constraints

**User Story:** As a maintainer, I want the client added without disturbing the Hybrid code, so that rooms keep working exactly as before.

#### Acceptance Criteria

1. THE implementation SHALL add new files under `src/` (`lib`, `hooks`, `components`, `pages`) and their tests, as listed in the design.
2. THE implementation SHALL change an existing file only at these integration points: `App.tsx` (two routes), `HomePage.tsx` (one link), `RoomPage.tsx` (open the Person_Sheet), `MessageItem.tsx` (optional username button), `MessageList.tsx` (optional props for texts and for the username button), `MessageComposer.tsx` (optional `target`).
3. EVERY change to an existing file SHALL be additive. WHEN the new optional props are absent, the file SHALL behave exactly as before, and every existing test SHALL pass without being edited.
4. THE implementation SHALL NOT change `firestore.rules`, `firestore.indexes.json`, `package.json` dependencies, or any existing file under `tests/rules`. It SHALL add no dependency, no Cloud Function and no paid-plan feature, and it SHALL NOT deploy.
5. THE implementation SHALL add no composite index. Whisper queries are limited to `where('memberIds', 'array-contains', uid)` on `whispers`, `where('userId', '==', uid)` on `whisperSlots`, and `orderBy('sentAt')` on one messages collection (the same single-field order that rooms already use). Ordering and filtering by status SHALL happen on the client.
6. Routing SHALL stay hash-based: `#whispers` for the Inbox and `#whisper/{id}` for a whisper.
7. THE implementation SHALL NOT build anything on the roadmap list in `product.md`, and SHALL NOT add a report button, notifications or a profile card beyond what this part lists.
8. THE three additions to the brief (cancel a sent invite, decline and block, unblock) SHALL stay small: buttons inside the existing Inbox rows and the Person_Sheet. They SHALL NOT add a screen.

### Requirement 13: Routes and entry points

**User Story:** As a person, I want to find my invites and my open whispers, so that I do not miss them.

#### Acceptance Criteria

1. WHEN the hash is `#whispers`, THE Client SHALL show the Inbox. WHEN the hash matches `#whisper/{id}` with an id of letters and digits, THE Client SHALL show the Whisper_Chat for that id. Every other hash SHALL behave as before.
2. THE Home screen header SHALL show a "Whispers" link with a touch target of at least 44px for accounts whose age band is `13_17` or `18_plus`. WHEN invites addressed to the person are pending, THE link SHALL show their count and an accessible name that includes it.
3. FOR an `under_13` account, THE Client SHALL NOT show the link, SHALL NOT show an invite button, and SHALL NOT read any whisper data. WHEN such an account opens `#whispers` or `#whisper/{id}` by hand, THE Client SHALL show the notice "Whispers aren't available for this account." and a link back, with no mention of any age limit, and SHALL open no listener. The age check SHALL happen in a wrapper component before any whisper hook runs, so no hook is called for that account.
4. EVERY whisper screen SHALL have a visible link back (to `#whispers` or `#`).

### Requirement 14: Inviting from a room

**User Story:** As a person in a room, I want to invite someone I am talking with to a private chat.

#### Acceptance Criteria

1. IN a room, THE username on another person's message SHALL be a button with an expanded tap area of at least 44px. Tapping it SHALL open the Person_Sheet showing that person's avatar and username and nothing else about them.
2. THE username SHALL NOT be a button on the person's own messages, on simulated demo messages, or when the viewer's own age band is `under_13`. THE Person_Sheet SHALL therefore never open for a simulated (demo) sender. One pure function (`canPickPerson`) decides this, and a test SHALL cover the simulated case.
3. Because the other person's age band is not readable, THE Client SHALL offer the invite regardless of the other person's band. THE Person_Sheet SHALL carry one neutral sentence that whispers work between people in the same age group and that not every invite can be sent. A cross-band invite SHALL fail in the rules and SHALL show the generic error (Requirement 20). The Client SHALL NOT infer, store, or display the other person's band.
4. THE Person_Sheet SHALL have these states, each with plain wording: loading; ready (Invite button); you have blocked this person (an Unblock button and no Invite); a whisper or invite with this person already exists (a link to it instead of Invite); sending; sent; failed.
5. WHEN the person taps Invite, THE Client SHALL pick a slot (Requirement 15), and WHEN none is free, SHALL show the "too many whispers" message and write nothing.
6. WHEN a slot is picked, THE Client SHALL write the Whisper and the inviter slot in one batch using the invite Write_Plan. The Whisper id SHALL be created once when the sheet opens and reused for retries. `expiresAt` SHALL be 97.5 minutes after the device time, which sits in the middle of the 75 to 120 minute window the rules accept, so a clock that is off by up to about 20 minutes still passes.
7. WHEN the batch succeeds, THE sheet SHALL say "Invite sent. {name} has 15 minutes to accept." and link to the Inbox. THE Client SHALL NOT navigate away by itself.
8. THE Invite button SHALL be disabled while a send is in progress. THE invite SHALL reuse its Whisper id on retry. IF a send fails for any reason (a denial, a timeout, or an offline check), THEN BEFORE showing an error THE Client SHALL re-read `whispers/{id}` once. WHEN it exists with status `requested` and the viewer as inviter, THE Client SHALL show "Invite sent" instead of an error. The reason is that a first attempt can succeed and still look like a failure, and then the retry is denied: a second `set` on that id is an update, and the slot's `whisperId` has not changed. IF the re-read itself fails or finds nothing, THE Client SHALL show the generic error.
9. THE Person_Sheet SHALL close on Escape and on a tap outside it, like the profile sheet.

### Requirement 15: Choosing a slot

**User Story:** As a person with up to three open whispers, I want the app to pick a free slot for me, so that I never have to think about slots.

#### Acceptance Criteria

1. THE Client SHALL read the person's own slots with one `getDocs` query (`where('userId', '==', uid)`) at the moment of the action, and SHALL NOT keep a listener on slots.
2. A slot SHALL count as free WHEN its document does not exist, OR the Whisper it names is not in the person's loaded whisper list, OR that Whisper is `declined` or `ended`, OR it is `requested` and at least 15 minutes plus a 60 second safety margin old, OR it is `accepted` and at least 1 hour plus a 60 second safety margin past `acceptedAt`.
3. THE Slot_Pick SHALL prefer a slot that never existed, then the free slot whose Whisper is oldest, and SHALL return none when all three are busy. It SHALL never return a busy slot.
4. THE same Slot_Pick SHALL be used for the invitee slot at accept time.
5. IF the pick was wrong because the data was stale, THEN THE rules deny the batch and the Client SHALL show the generic error. THE Client SHALL NOT retry with another slot automatically.
6. THE Client SHALL NOT write a slot outside the batch of an invite or an accept, and SHALL NOT delete a slot.

### Requirement 16: Requests inbox

**User Story:** As a person, I want one place to see invites for me and my open whispers.

#### Acceptance Criteria

1. THE Inbox SHALL read the person's whispers with one listener (`array-contains` on `memberIds`) and SHALL build these sections on the client, omitting a section that is empty: **Invites for you** (status `requested`, the person is the invitee, less than 15 minutes since `createdAt`, soonest to expire first), **Open whispers** (status `accepted`, less than 1 hour since `acceptedAt`, soonest to end first), **Waiting for a reply** (status `requested`, the person is the inviter, still inside the 15 minutes, newest first).
2. Declined, ended, expired and finished whispers SHALL NOT be listed.
3. EACH invite row SHALL show the inviter's avatar and username, and the time left to accept ("14 min left", or "Under a minute left").
4. WHEN the person taps Accept, THE Client SHALL first check the invite window against the device clock. IF it has passed, THEN THE Client SHALL show "This invite expired." and write nothing. OTHERWISE it SHALL pick a slot, show "too many whispers" if none is free, or write the accept Write_Plan, and on success open `#whisper/{id}`.
5. IF an accept fails (a denial, a timeout, or an offline check), THEN THE Client SHALL read the Whisper once. WHEN it is `accepted` with the viewer as invitee, THE Client SHALL treat the accept as done and open the whisper (the first attempt went through). WHEN it is stale or no longer `requested` for any other reason, THE Client SHALL show "This invite expired." OTHERWISE it SHALL show the generic error.
6. WHEN the person taps Decline, THE Client SHALL write the decline Write_Plan. THE row SHALL disappear when the snapshot arrives.
7. "Decline and block" SHALL write the decline and the block entry in one batch (Requirement 18).
8. EACH Waiting row SHALL have a Cancel button that writes the cancel Write_Plan.
9. THE sections SHALL be recomputed on every snapshot and on the shared 30 second clock (`useNow`), so a stale invite leaves the list within about 30 seconds.
10. THE Inbox SHALL show a calm empty state ("No whispers right now. Tap a name in a room to invite someone."), a loading state, and a plain-language error state with a Try again button.

### Requirement 17: Whisper chat and the one-hour countdown

**User Story:** As a person in a whisper, I want to chat, see how long is left, and be sure it is gone from my screen when it ends.

#### Acceptance Criteria

1. THE Whisper_Chat SHALL listen to the Whisper document and show what the Thread_Phase calls for: `invite_open` as the invitee (Accept and Decline, time left); `invite_open` as the inviter ("Waiting for {name}", time left, Cancel); `invite_expired` ("This invite expired."); `open` (the chat); `time_up`, `declined` and `ended` (all three show "This whisper has ended." with no cause); document missing or unreadable ("This whisper isn't available.").
2. IN the `open` phase, THE header SHALL show the other person's avatar and username, a countdown to `acceptedAt` plus 1 hour in `mm:ss`, an End action and an End and block action. One line SHALL say: "Only you and {name} can read this in the app. It ends 1 hour after it was accepted."
3. THE countdown SHALL be computed from `acceptedAt` and the device clock, SHALL update every second, and SHALL be rendered by a small component so the message list does not re-render each second.
4. WHEN the countdown reaches zero, THE Client SHALL within one second switch to the ended view. In that moment the message list, the composer (and any unsent draft) SHALL unmount, the messages listener SHALL unsubscribe, and the in-memory messages SHALL be dropped. Nothing SHALL depend on the rules re-checking an open listener.
5. WHEN the Whisper document changes to `ended` (the other person ended it, or a block ended it), THE Client SHALL switch to the ended view immediately, with the same clearing.
6. IF the messages listener reports permission-denied while the Whisper still looks open, THEN THE Client SHALL treat it as ended (the device clock was behind the server).
7. THE messages listener SHALL exist only while the phase is `open`. It SHALL use `orderBy('sentAt')` and `limitToLast(200)` like rooms, and SHALL need no new index.
8. THE Whisper_Chat SHALL NOT use the Delay Shield, the catch-up bar or the unseen count. Those are room features.
9. THE one-shot timer that ends the chat at the hour mark SHALL also be re-checked when the page becomes visible again and when the window gets focus, because a single timer fires late after the device sleeps or the tab is throttled. At each of these events the Client SHALL compare the device clock with `acceptedAt` plus 1 hour and switch to the ended view at once when it has passed.

### Requirement 18: Ending and blocking

**User Story:** As a person, I want to leave a whisper, and to stop someone from inviting me again.

#### Acceptance Criteria

1. THE End action SHALL ask once ("End this whisper?" with End and Keep chatting) before it writes, so a mis-tap does not end the thread.
2. THE action written SHALL follow the person's role and the status, as the rules define: invitee on `requested` writes decline; inviter on `requested` writes cancel (`ended`, `endedBy` set); either member on `accepted` writes end (`ended`, `endedBy` set). FOR any other status THE Client SHALL write no Whisper update.
3. "End and block" SHALL write the Whisper update and the block entry `users/{uid}/blocked/{otherUid}` (`blockedId`, `blockedAt`) in one batch. WHEN the Whisper is already over, it SHALL write the block entry alone.
4. THE person who is blocked SHALL see only "This whisper has ended." and nothing that says they were blocked.
5. THE Person_Sheet SHALL offer Unblock for a person the viewer has blocked, which deletes that block entry. THE Unblock button SHALL exist in the sheet's blocked state, and a test SHALL check it.
6. THE words "ends" and "ended" SHALL be used for threads. THE Client SHALL NOT say a thread is deleted, erased or removed.
7. IF any of these writes fails, THEN THE Client SHALL show the generic error and leave the screen unchanged.

### Requirement 19: Messages and Ghost-Mode

**User Story:** As a person, I want whisper messages to get the same protections as room messages.

#### Acceptance Criteria

1. THE Whisper_Chat SHALL use the existing `MessageComposer`, `MessageList`, `MessageItem`, `useGhostCheck` and `useMessageGuard`. THE implementation SHALL NOT copy them.
2. `MessageComposer` SHALL gain one optional `target` prop that supplies the pre-check, the send function and the error wording. WHEN `target` is absent, the composer SHALL behave exactly as before.
3. THE sender check SHALL be the existing one: redaction by plain code first, then the on-device model, or the cloud model only when the person has given cloud consent, then the review panel when something is flagged. Consent SHALL be the same stored setting that rooms use, because it is the same task (a check of the person's own draft). THE whisper composer SHALL show the same consent line as the room composer ("Allow a cloud check when this device can't do it..."), which is part of the existing `GhostStatus` panel, on every screen width. A test SHALL check that the open chat's markup contains that line.
4. THE reader check SHALL be `useMessageGuard` unchanged: plain-code patterns, and the on-device model only. Other people's whisper messages SHALL NEVER be sent to the cloud.
5. THE send SHALL write the message and the rate-limit document in one batch with `expiresAt` copied from the Whisper, using a message id made once per draft, so a retry cannot post twice.
6. THE pre-check SHALL mirror the rules in plain words: empty, over 280 characters, faster than one message every 3 seconds, a link while the sender is in probation, and the thread being closed at `acceptedAt` plus 1 hour.
7. THE AI status badge and the inference drawer SHALL stay visible on wide screens as well as small ones, as in rooms.
8. WHEN the thread has closed, THE sender SHALL see "This whisper has ended, so messages can no longer be sent." For every other failure the existing room wording SHALL apply (it describes the person's own draft or connection). A block SHALL show the existing generic "Your message wasn't sent. Please try again."
9. IF a send is denied and the device clock is within 60 seconds either side of `acceptedAt` plus 1 hour, THEN THE Client SHALL treat the thread as ended: it SHALL show "This whisper has ended" (the closed wording above) and switch the page to the ended view, instead of showing a generic error. The cause is almost always the hour passing between the pre-check and the write.

### Requirement 20: Errors

**User Story:** As a person, I want clear errors that do not reveal anything about the other person.

#### Acceptance Criteria

1. THE Client SHALL use exactly two specific error messages for invites, accepts, ends and blocks: "You have too many whispers open. End one or wait for one to finish, then try again." and "This invite expired."
2. EVERY other failure of those actions SHALL show one generic message: "That didn't work. Check your connection and try again."
3. THE two specific messages SHALL be chosen from facts the client already has (no free slot; the invite window has passed or the re-read Whisper is stale or no longer open). THE Client SHALL NOT choose any message from the cause of a rules denial.
4. NO message SHALL mention a block, an age, an age band, an adult, a teen or a minor, or reveal any setting of the other person.
5. THE Client MAY log the error code to the console. THE screen SHALL NOT show it.
6. THE Firestore web SDK does not reject a batch while the device is offline: it queues the write and the commit promise waits. THEREFORE every invite, accept, decline, cancel, end, block and unblock SHALL first check `navigator.onLine` (as `sendMessage` does) and, when offline, show the generic error and write nothing.
7. EVERY such commit SHALL also have a timeout of 10 seconds. A timeout SHALL show the generic error (after the re-reads in Requirements 14.8 and 16.5, which are themselves bounded by the same timeout). NO button SHALL spin forever. A write that timed out may still be applied later by the SDK; the live whisper list then shows the result, and a retry that is denied is resolved by the re-reads above.
8. THE conversion of a Write_Plan into Firestore operations SHALL live in one function, `applyPlan(db, plan)`, that does not import `lib/firebase`. THE client's `commit` and the emulator contract test SHALL both call it.

### Requirement 21: Look, wording and states

**User Story:** As a person on a phone, I want whispers to look and read like the rest of Volubly.

#### Acceptance Criteria

1. THE new screens SHALL use Tailwind and the existing colour tokens only (`night`, `surface`, `raised`, `line`, `ink`, `muted`, `accent`, `spark`, `live`, `warn`, `danger`, `plum`). THEY SHALL NOT use hard-coded colours.
2. EVERY button and link SHALL have a touch target of at least 44px, and text SHALL be at least 12px.
3. ANY animation SHALL use the `motion-safe:` prefix. No animation is required.
4. EVERY list screen SHALL have a calm empty state, a loading state and a plain-language error state (`role="alert"`).
5. ALL user-facing whisper wording SHALL live in one module (`whisperCopy.ts`). THAT module SHALL NOT contain "delete", "deleted", "erase", "encrypted", "private from", "secure", "safe", "100%" or "bot", and the claims in `safety-and-claims.md` SHALL hold: only "Only you and {name} can read this in the app", not any claim of encryption or total privacy.

### Requirement 22: Listeners and clearing

**User Story:** As a maintainer, I want no leaked listeners, because each one costs reads on the free plan.

#### Acceptance Criteria

1. EVERY Firestore listener added in Part 2 SHALL be created through one helper, `useSubscription`, which unsubscribes on unmount and whenever its inputs change.
2. THE helper SHALL map permission-denied to a `denied` state and any other error to an `error` state with a retry, and SHALL NOT set state after unmount.
3. THE listeners are: the person's whispers (Home link, Inbox, and an open Person_Sheet), one Whisper (Whisper_Chat) and one Whisper's messages (Whisper_Chat, open phase only). One-shot reads (slots, a block entry, a re-read after a denial) SHALL use `getDoc` or `getDocs` and SHALL ignore their result after unmount.
4. THE implementation SHALL NOT add a listener on slots, on block entries or on other people's profiles (profiles use the existing cached `useProfiles`).
5. EVERY document read in `useWhispers`, `useWhisper` and `useWhisperMessages` SHALL use `data({ serverTimestamps: 'estimate' })`, so a write that has not reached the server yet still has usable times.

### Requirement 23: Client tests

**User Story:** As a developer, I want tests that fail when a rule of the client is broken.

#### Acceptance Criteria

1. THE tests SHALL use Vitest and fast-check, live next to the code under `src/**/__tests__`, and render components with `renderToStaticMarkup`. WHERE a component reaches `src/lib/firebase.ts` through an import, THE test SHALL stub that module with `vi.mock`.
2. THE tests SHALL include these fast-check properties: (a) exactly one Thread_Phase holds for any Whisper_View and time, and `open` holds exactly when `status == 'accepted'` and now is before `acceptedAt` plus 1 hour; (b) the Slot_Pick never returns a busy slot and returns none exactly when all three are busy; (c) inbox sections never list a declined, ended, expired or finished whisper, never list an invite the person sent in "Invites for you", and are sorted as specified; (d) every Write_Plan uses exactly the field set the rules allow for that transition, a slot document carries the same `expiresAt` as its Whisper and names the slot the Whisper names, and a message plan always includes its rate-limit write; (e) the generic and specific error texts never contain a forbidden word, and only two specific texts exist; (f) the countdown text is never negative and never increases as time passes.
3. THE tests SHALL include one hook test using `react-dom/client` and `act` that mounts a component using `useSubscription`, unmounts it, and checks the unsubscribe function ran once. Static rendering never runs effects, so this is the one place `renderToStaticMarkup` is not enough. `jsdom` 25.0.1 is already installed and is the Vitest environment, so no dependency is added. IF `jsdom` and `happy-dom` were both missing, THE test SHALL instead call `useSubscription`'s plain core with a fake `open` function that counts unsubscribes, and NO dependency SHALL be added.
4. THE tests SHALL include an emulator contract test in a new file under `tests/rules` that runs the client's Write_Plans against the real rules through `applyPlan(db, plan)` (the same function the client's `commit` calls), and expects every one to succeed, and expects the wrong-slot and wrong-field variants to fail. This keeps the client and the rules from drifting apart. THE test SHALL NOT contain its own copy of the plan-to-batch conversion.
5. THE tests SHALL cover the offline and timeout handling (Requirement 20.6 and 20.7) with injected fakes and fake timers: offline writes nothing, a never-settling commit gives the generic error after the timeout, and a settled commit clears the timer.
6. AFTER every task THE implementation SHALL run `npx tsc --noEmit -p tsconfig.app.json` and `npm test`. AFTER the Write_Plan task and the final task it SHALL also run `npm run test:emulator`. Every existing test SHALL still pass.
7. THE implementation SHALL make one git commit per task.

### Requirement 24: Documentation

**User Story:** As a reader of the write-up, I want the client described at its real strength.

#### Acceptance Criteria

1. EACH task SHALL append one short line to a "Whisper threads: client" section of `docs/build-log.md`.
2. THE log SHALL state what Kiro generated, that enforcement is still only in `firestore.rules`, that the client cannot see the other person's age band, that the age band is self-declared, that the slot cap limits spam, not a hard guarantee, that threads are not end-to-end encrypted, and that nothing was deployed.
3. THE log and the UI wording SHALL NOT claim end-to-end encryption, "private from everyone", "zero logs", "child-safe" or "safe for children".
4. THE README "Limitations, said plainly" list SHALL gain one line: ended whispers stay in the database until a TTL policy is set up. It SHALL say "ends" and SHALL NOT say "deleted".

## Decisions recorded after review (Part 2)

1. **Age bands.** The client cannot see the other person's band, and the band is not published on `publicProfiles`. The neutral sheet line and the generic error stay (14.3).
2. **Three additions kept, kept small:** cancel a sent invite, decline and block, unblock in the Person_Sheet. They are buttons in existing views, with no new screen (12.8).
3. **Shared cloud consent.** Whisper drafts share the room consent, and the whisper composer shows the same consent line (19.3).
4. **Error wording.** Messages are chosen from what the client knows, never from the rules error (20.3). Message sending keeps the existing room texts (19.8).
5. **Shared components.** Additive changes only. The existing room tests pass unchanged (12.3).
6. **Reads and TTL.** The whisper list reads finished whispers until a TTL policy removes them. One README limitation line says so, using "ends" (24.4). TTL setup itself is not part of this work.
7. **Tasks 1 to 9 ticked.** The 225 emulator tests back them up.
8. **Added in review:** offline check and 10 second timeout on every write (20.6, 20.7); invite and accept re-read after an unclear result (14.8, 16.5); `applyPlan` shared by the client and the emulator test (20.8, 23.4); a denied send near the hour mark ends the chat (19.9); the hour timer re-checks on visibility and focus (17.9); `serverTimestamps: 'estimate'` on every read (22.5).
9. **Not in this part:** a report button on whisper messages, notifications, TTL policy setup in the Firebase console, and any deploy.