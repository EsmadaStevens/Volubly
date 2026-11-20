# Requirements Document

## Introduction

This feature limits each account to at most 2 active rooms at a time. An active room is a room that is not yet closed, meaning request.time is earlier than openedAt + 24 hours, as defined in the rooms-and-expiry spec.

The limit is enforced only in `firestore.rules`. There are no Cloud Functions, and the project stays on the Spark plan. Firestore rules cannot count documents, so each account owns two fixed slot documents, `roomSlots/{uid}_1` and `roomSlots/{uid}_2`. Creating a room is a single batch write that contains the room and one slot document. The room create is allowed only when the same batch also writes a valid slot for the creating user.

The limit limits spam, not a hard guarantee. Anonymous accounts can be recreated, so a determined person can obtain a new account and new slots. Client code (including `createRoom`) is out of scope and is updated separately.

## Glossary

- **Rules_Engine**: The Firestore security rules in `firestore.rules`, evaluated by Firestore for every client request.
- **Room**: A document at `rooms/{roomId}` as defined in the rooms-and-expiry spec.
- **Active_Room**: A Room for which request.time is earlier than the Room's openedAt plus 24 hours.
- **Closed_Room**: A Room for which request.time is equal to or later than the Room's openedAt plus 24 hours.
- **Room_Slot**: A document at `roomSlots/{uid}_1` or `roomSlots/{uid}_2` with the fields userId, roomId, openedAt and expiresAt.
- **Slot_Owner**: The user whose uid forms the prefix of the Room_Slot document ID.
- **Previous_Room**: The Room referenced by the roomId stored in an existing Room_Slot before the current request.
- **Expired_Slot**: An existing Room_Slot whose stored openedAt plus 24 hours is equal to or earlier than request.time.
- **Room_Create_Batch**: A single batched write that creates one Room and writes one Room_Slot for the same user.
- **Slot_TTL_Field**: The expiresAt field of a Room_Slot, used only by Firestore TTL deletion and not used for enforcement.
- **Rules_Test_Suite**: The Vitest, fast-check and `@firebase/rules-unit-testing` tests in `tests/rules`, run with `npm run test:emulator`.
- **Admin_Context**: The rules-unit-testing context that bypasses security rules, used to seed documents with backdated openedAt values.

## Requirements

### Requirement 1: Slot document structure

**User Story:** As a platform maintainer, I want each user to have exactly two named slot documents, so that the rules can bound active rooms without counting documents.

#### Acceptance Criteria

1. IF a Room_Slot write targets a document ID that is not exactly the requesting user's uid followed by `_1` or `_2`, THEN THE Rules_Engine SHALL reject the write and leave all existing Room_Slot documents unchanged.
2. IF a Room_Slot write comes from a request with no authenticated user, THEN THE Rules_Engine SHALL reject the write and leave all existing Room_Slot documents unchanged.
3. IF the data of a Room_Slot write does not contain exactly the four fields userId, roomId, openedAt and expiresAt, THEN THE Rules_Engine SHALL reject the write. A missing field, an extra field, and a renamed field each count as a mismatch.
4. IF a Room_Slot write has a userId that does not equal request.auth.uid, THEN THE Rules_Engine SHALL reject the write.
5. IF a Room_Slot write has an openedAt that does not equal request.time, THEN THE Rules_Engine SHALL reject the write.
6. IF a Room_Slot write has a roomId that is not a string, or is a string with length 0, THEN THE Rules_Engine SHALL reject the write.
7. IF a Room_Slot write has an expiresAt that is not a timestamp equal to the expiresAt of the Room created in the same Room_Create_Batch, THEN THE Rules_Engine SHALL reject the write.
8. WHEN a Room_Slot write meets criteria 1 to 7, THE Rules_Engine SHALL accept the write.

### Requirement 2: Room creation requires a slot in the same batch

**User Story:** As a platform maintainer, I want every room create to be paired with a slot write, so that no room can be created outside the limit.

#### Acceptance Criteria

1. WHEN a client creates a Room, THE Rules_Engine SHALL allow the create only when the same batch also writes a Room_Slot for request.auth.uid, as verified with existsAfter.
2. IF a client creates a Room and the same batch does not write a Room_Slot for request.auth.uid, THEN THE Rules_Engine SHALL deny the Room create, the client SHALL receive a permission-denied result, and no document in the batch SHALL be written.
3. WHEN a client creates a Room, THE Rules_Engine SHALL allow the create only when the Room_Slot written in the batch has a roomId equal to the new Room's document ID, as verified with getAfter.
4. WHEN a client creates a Room, THE Rules_Engine SHALL allow the create only when the Room_Slot written in the batch has an openedAt equal to the new Room's openedAt, as verified with getAfter.
5. IF a Room_Slot write in a batch has a roomId that references a Room that was not created by request.auth.uid in the same batch, THEN THE Rules_Engine SHALL deny the Room_Slot write, the client SHALL receive a permission-denied result, and no document in the batch SHALL be written.
6. THE Rules_Engine SHALL keep every existing Room create rule from the rooms-and-expiry spec in force in addition to the slot requirement.
7. IF a client writes a Room_Slot whose owner uid is not request.auth.uid, THEN THE Rules_Engine SHALL deny the Room_Slot write, the client SHALL receive a permission-denied result, and no document in the batch SHALL be written.
8. THE Rules_Engine SHALL require each Room create in a batch to be matched by its own Room_Slot, so that one Room_Slot cannot satisfy two Room creates.

### Requirement 3: Two-active-room limit

**User Story:** As a community member, I want each account restricted to two active rooms, so that one account cannot flood the room list.

#### Acceptance Criteria

1. WHEN a user submits a Room_Create_Batch that creates a Room_Slot at one of the user's two slot IDs and no Room_Slot exists at that ID, THE Rules_Engine SHALL allow the Room_Create_Batch.
2. WHEN the user's first Room_Slot holds an Active_Room and no document exists at the user's second slot ID, THE Rules_Engine SHALL allow a Room_Create_Batch that creates the second Room_Slot.
3. IF both of the user's Room_Slots exist and neither is an Expired_Slot, THEN THE Rules_Engine SHALL deny a new Room_Create_Batch for that user, and no Room or Room_Slot document SHALL be written.
4. WHEN a Room_Slot exists and is an Expired_Slot, THE Rules_Engine SHALL allow a Room_Create_Batch that rewrites that Room_Slot with the new Room's roomId and openedAt.
5. THE Rules_Engine SHALL treat a Room_Slot as an Expired_Slot when request.time is greater than or equal to the stored openedAt plus 24 hours, and SHALL NOT use the Slot_TTL_Field for this determination.
6. WHEN a Room_Create_Batch creates a Room_Slot at a slot ID where no document exists, THE Rules_Engine SHALL allow the write without reading any Previous_Room.
7. IF a Room_Create_Batch targets a slot ID that is not one of the requesting user's two slot IDs, THEN THE Rules_Engine SHALL deny the Room_Create_Batch, and no Room or Room_Slot document SHALL be written.
8. IF a Room_Create_Batch rewrites a Room_Slot that exists and is not an Expired_Slot, THEN THE Rules_Engine SHALL deny the Room_Create_Batch, and the existing Room_Slot SHALL remain unchanged.

### Requirement 4: Slot immutability

**User Story:** As a platform maintainer, I want slots to be unchangeable by clients except when reused, so that a user cannot free a slot while the room is still active.

#### Acceptance Criteria

1. THE Rules_Engine SHALL deny every client delete of a Room_Slot, whether the slot is expired or not.
2. IF a client updates a Room_Slot whose stored openedAt plus 24 hours is later than request.time, THEN THE Rules_Engine SHALL deny the update and leave the stored Room_Slot unchanged.
3. IF a client updates an Expired_Slot without creating a new Room in the same batch, THEN THE Rules_Engine SHALL deny the update and leave the stored Room_Slot unchanged. An Expired_Slot is a Room_Slot whose stored openedAt plus 24 hours is less than or equal to request.time.
4. WHEN a client updates an Expired_Slot in a Room_Create_Batch with a new roomId and openedAt equal to request.time, THE Rules_Engine SHALL allow the update. The new roomId differs from the roomId stored in the slot and matches the Room created in the same batch.
5. IF a client updates an Expired_Slot in a Room_Create_Batch with an openedAt that is not equal to request.time, or with a roomId that equals the roomId stored in the slot or does not match the Room created in the same batch, THEN THE Rules_Engine SHALL deny the update and leave the stored Room_Slot unchanged.
6. THE Rules_Engine SHALL treat the Slot_TTL_Field as informational for Firestore TTL deletion only, and SHALL NOT use the Slot_TTL_Field in any allow condition other than the equality check in Requirement 1.

### Requirement 5: Slot privacy

**User Story:** As a user, I want my slots readable only by me, so that other people cannot see which rooms I opened.

#### Acceptance Criteria

1. WHEN an authenticated user performs a get on a Room_Slot whose Slot_Owner is that user, THE Rules_Engine SHALL allow the read and return the Room_Slot.
2. IF an authenticated user performs a get on a Room_Slot whose Slot_Owner is a different user, THEN THE Rules_Engine SHALL deny the read with a permission-denied result and return no Room_Slot data.
3. IF an unauthenticated client performs a get or a list on a Room_Slot or the roomSlots collection, THEN THE Rules_Engine SHALL deny the operation with a permission-denied result and return no Room_Slot data.
4. IF a user creates, updates, or deletes a Room_Slot whose document ID prefix is a different user's uid, THEN THE Rules_Engine SHALL deny the write with a permission-denied result and leave the stored Room_Slot unchanged.
5. IF a client lists the roomSlots collection with a query that is not restricted to Room_Slots whose Slot_Owner is the requesting user, THEN THE Rules_Engine SHALL deny the entire query with a permission-denied result and return zero Room_Slots, including the requesting user's own.
6. WHEN an authenticated user lists the roomSlots collection with a query restricted to Room_Slots whose Slot_Owner is that user, THE Rules_Engine SHALL allow the query and return only that user's Room_Slots.
7. WHEN an authenticated user creates or updates a Room_Slot whose document ID prefix is that user's uid, THE Rules_Engine SHALL allow the write, subject to the slot validation rules defined in the other requirements of this spec.

### Requirement 6: Rules tests

**User Story:** As a developer, I want emulator tests for the limit, so that each rule is shown to deny the bad case and allow the matching good case.

#### Acceptance Criteria

1. THE Rules_Test_Suite SHALL include, for every denial test in this spec, one positive-control test in which a matching valid case differs from the denied case only in the condition under test, and in which the write or read succeeds.
2. WHEN the Rules_Test_Suite runs a Room_Create_Batch as userADb for a user with no Active_Rooms, THE Rules_Test_Suite SHALL verify that the first batch succeeds and that a second batch by the same user, made while exactly one Room_Slot holds an Active_Room, also succeeds.
3. IF userADb submits a third Room_Create_Batch while both Room_Slots hold Active_Rooms, THEN THE Rules_Test_Suite SHALL verify that the batch is denied and that no Room document and no Room_Slot change from the batch exists afterwards, read through adminDb.
4. WHEN a third Room_Create_Batch is submitted by userADb after the first Room_Slot has become an Expired_Slot, THE Rules_Test_Suite SHALL verify that the batch succeeds. The Rules_Test_Suite SHALL make the slot expired by using a fixed clock or by backdating openedAt by more than 24 hours through adminDb.
5. IF userADb submits a Room create without a Room_Slot write in the same batch, THEN THE Rules_Test_Suite SHALL verify that the create is denied.
6. IF userADb submits a Room_Slot whose roomId refers to a Room owned by userB, THEN THE Rules_Test_Suite SHALL verify that the write is denied.
7. IF userBDb or unauthDb attempts to read or write a Room_Slot belonging to userA, THEN THE Rules_Test_Suite SHALL verify that each attempt is denied, and that userADb can read the same Room_Slot.
8. IF userADb attempts to delete its own Room_Slot, THEN THE Rules_Test_Suite SHALL verify that the delete is denied and that the Room_Slot still exists when read through adminDb.
9. IF userADb attempts to update a Room_Slot that is not an Expired_Slot, or attempts to update an Expired_Slot outside a Room_Create_Batch, THEN THE Rules_Test_Suite SHALL verify that each update is denied. The Rules_Test_Suite SHALL also verify that updating an Expired_Slot as part of a Room_Create_Batch succeeds.
10. THE Rules_Test_Suite SHALL include at least one fast-check property-based test for the two-active-room limit and at least one fast-check property-based test for Room_Slot immutability, and these property-based tests are required, not optional.
11. WHILE a fast-check property runs against the emulator, THE Rules_Test_Suite SHALL configure the property with numRuns set to 20 or fewer.
12. THE Rules_Test_Suite SHALL obtain its authenticated, unauthenticated and admin Firestore contexts only from the userADb, userBDb, unauthDb and adminDb helpers in `tests/rules/helpers.ts`.
13. WHEN a test in the Rules_Test_Suite finishes, THE Rules_Test_Suite SHALL leave no Room or Room_Slot data that is visible to the next test, so that every test starts from an empty state.

### Requirement 7: Honest documentation of the limit

**User Story:** As a user and reviewer, I want the limit described accurately, so that nobody believes it is stronger than it is.

#### Acceptance Criteria

1. THE spec documents for this feature, the entry for this feature in `docs/build-log.md`, and the steering file `safety-and-claims.md` SHALL each describe the limit with the exact phrase "limits spam, not a hard guarantee".
2. THE spec documents for this feature, the entry for this feature in `docs/build-log.md`, and the steering file `safety-and-claims.md` SHALL each state that anonymous accounts can be recreated and that a recreated account can obtain new slots.
3. WHERE the feature is mentioned in `docs/build-log.md`, THE entry SHALL state that enforcement is in `firestore.rules` only and that no Cloud Functions are used.
4. THE spec documents, the build log entry and any user-facing string for this feature SHALL NOT claim the limit is unbypassable, complete, or a hard guarantee.

### Requirement 8: Scope and constraints

**User Story:** As a maintainer, I want the work confined to rules and tests, so that client changes can be made separately.

#### Acceptance Criteria

1. THE implementation SHALL modify only `firestore.rules`, the Rules_Test_Suite files, and documentation and steering files, and SHALL leave every other file in the repository unchanged.
2. THE implementation SHALL leave every file under `src`, including the `createRoom` function, unchanged.
3. THE Rules_Engine SHALL enforce the limit using only Firestore security rules, with no Cloud Functions deployed and no feature that requires a paid Firebase plan.
4. THE Rules_Engine SHALL treat a room as open and a slot as unexpired only IF the evaluation time is strictly less than openedAt plus 24 hours, as defined in the rooms-and-expiry spec.
5. IF the evaluation time is equal to or later than openedAt plus 24 hours, THEN THE Rules_Engine SHALL treat the room as closed and the slot as expired, and SHALL no longer count that slot toward the limit.
6. IF openedAt is missing or is not a timestamp on a room document, THEN THE Rules_Engine SHALL deny the write that depends on it.