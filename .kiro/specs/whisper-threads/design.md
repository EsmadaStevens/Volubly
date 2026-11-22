# Design Document

## Overview

A whisper thread is a private chat between two people. It is enforced entirely in `firestore.rules`. There are no Cloud Functions and the project stays on the Spark plan. This spec changes rules, tests and docs only. Nothing under `src/` changes.

Honest claims for this feature:

- Only the two people can read a thread through the app. It is not end-to-end encrypted. Messages are stored in Firestore.
- The age band is self-declared. Pairing people only within the same band is best-effort protection, not a guarantee.
- The open-whisper cap limits spam, not a hard guarantee. Anonymous accounts can be recreated, and a recreated account gets new slots.

A denied invite, accept or message always looks like a plain permission-denied. The rules give no reason, and the design adds no cause-specific behaviour. A block and an age mismatch are indistinguishable to the caller.

## Time model

Every window is computed from stored timestamps compared with `request.time`. The `expiresAt` fields are never read by an allow condition, except in equality checks that copy a value from a parent document (see "expiresAt hints").

| Window | Rule |
| --- | --- |
| Invite can be accepted | `request.time < createdAt + 15 minutes` |
| Thread is open | `status == 'accepted'` and `request.time < acceptedAt + 1 hour` |
| Probation | `request.time < users/{uid}.createdAt + 1 hour` |
| Message rate limit | previous `lastMessageAt < request.time - 3 seconds` |

`createdAt` and `acceptedAt` are set to `request.time` by the rules, so a client cannot choose them. The emulator cannot move time, so tests plant backdated documents with the admin context.

## Data model

### `whispers/{whisperId}`

| Field | Type | Set at | Notes |
| --- | --- | --- | --- |
| `inviterId` | string | invite | equals `request.auth.uid` |
| `inviteeId` | string | invite | not equal to `inviterId` |
| `memberIds` | list | invite | exactly `[inviterId, inviteeId]`; used by the list query |
| `status` | string | invite, then transitions | `requested`, `accepted`, `declined`, `ended` |
| `createdAt` | timestamp | invite | `== request.time` |
| `acceptedAt` | timestamp or null | accept | null until accepted; `== request.time` |
| `endedBy` | string or null | end or cancel | uid of the person who ended it; null otherwise |
| `inviterSlot` | int 1 to 3 | invite | which of the inviter's slots this thread uses |
| `inviteeSlot` | int 1 to 3 or null | accept | which of the invitee's slots this thread uses |
| `expiresAt` | timestamp | invite | cleanup hint only |

### Adjustments to the brief, and why

1. **`inviterSlot` and `inviteeSlot` on the Whisper.** With three slots per person, a rule that tries slot 1, then 2, then 3 can cost 6 lookups for the slot check alone (an exists and a get per slot). Naming the slot on the Whisper means the rules check one slot: `whisperSlots/{inviterId}_{inviterSlot}` at invite, and `whisperSlots/{inviteeId}_{inviteeSlot}` at accept. The client picks a free slot (it can read its own slots). If the pick is wrong, the batch is denied. This is the lookup-budget adjustment required by Requirement 8.6.
2. **Invitee slot is written at accept, not at invite.** An invitee cannot write a slot in the inviter's batch, because slot IDs are restricted to the writer's own uid. A pending invite therefore counts only toward the inviter. An accepted thread counts toward both.
3. **`endedBy` is also used for cancel.** The inviter can move `requested` to `ended`. `endedBy` holds the inviter's uid. Decline by the invitee keeps `endedBy == null`, because `declined` already says who acted.
4. **`expiresAt` bounds at create.** `request.time + 1h15m <= expiresAt <= request.time + 2h`. The lower bound is the longest a thread can live (15 minutes pending plus 1 hour open). It keeps TTL cleanup from deleting a live thread, its slots or its messages. The rules never use `expiresAt` to allow or deny access.
5. **Slot reuse treats a missing previous Whisper as over.** If TTL cleanup deleted the old Whisper first, a `get` on it would raise an error and the slot would be stuck. The rule uses `!exists(prev) || over(get(prev).data)`.
6. **`blockedId` and `blockedAt` on a block entry.** Exactly those two fields, so a block entry is a small fixed shape.

### `whispers/{whisperId}/messages/{messageId}`

`messageId`, `senderId`, `body`, `sentAt`, `whisperId`, `expiresAt`. Same rules as rooms: `senderId == request.auth.uid`, `messageId == document ID`, `whisperId == parent ID`, `sentAt == request.time`, body is a string of 1 to 280 characters, `expiresAt == parent.expiresAt`. No update, no delete.

### `whispers/{whisperId}/rateLimits/{uid}`

`userId`, `lastMessageAt`, `expiresAt`, as in `rooms/{roomId}/rateLimits/{userId}`. Written by the owner only, in an open thread only.

### `whisperSlots/{uid}_{n}`, n = 1 to 3

`userId`, `whisperId`, `openedAt`, `expiresAt`. `expiresAt` equals the Whisper's `expiresAt` (copied, never trusted for access), so TTL cleanup cannot delete a slot while its thread is live.

### `users/{uid}/blocked/{otherUid}`

`blockedId` (equals `otherUid`), `blockedAt` (`== request.time`). Readable, writable and deletable only by `uid`. Blocks are private, including from the blocked person.

## Rules design

New helpers sit beside the existing ones. Existing blocks for `rooms`, `roomSlots`, `users` and `publicProfiles` keep their rules. The only edit to an existing `match` is the new `blocked` child under `users/{userId}`.

```
function wPath(id)        // /whispers/$(id)
function uPath(uid)       // /users/$(uid)
function blockPath(blocker, blocked)   // /users/$(blocker)/blocked/$(blocked)

function bandOf(uid)      { return get(uPath(uid)).data.ageBandLabel; }
function bandsPair(a, b)  { let x = bandOf(a); return x == bandOf(b) && x in ['13_17', '18_plus']; }

function isOpenThread(w)  { return w.status == 'accepted' && w.acceptedAt != null
                              && request.time < w.acceptedAt + duration.value(3600, 's'); }
function isPending(w)     { return w.status == 'requested'
                              && request.time < w.createdAt + duration.value(900, 's'); }
function isOver(w)        { return w.status in ['declined', 'ended']
                              || (w.status == 'requested' && request.time >= w.createdAt + duration.value(900, 's'))
                              || (w.status == 'accepted'  && request.time >= w.acceptedAt + duration.value(3600, 's')); }

function slotIdFor(uid, n) { return n == 1 ? uid + '_1' : (n == 2 ? uid + '_2' : uid + '_3'); }
function isMember(w)       { return request.auth.uid in w.memberIds; }
```

The slot ID is built with a ternary, not `string(n)`, so the rules do not depend on int-to-string conversion.

### `whispers/{whisperId}`

- **get:** `isAuthed() && isMember(resource.data)`.
- **list:** `isAuthed() && isMember(resource.data)`. A query must carry `where('memberIds', 'array-contains', uid)` or the whole query is denied.
- **create:** inviter is the caller, exact field set, `memberIds == [inviterId, inviteeId]`, `status == 'requested'`, `createdAt == request.time`, `acceptedAt == null`, `endedBy == null`, `inviteeSlot == null`, `inviterSlot in [1, 2, 3]`, `expiresAt` within the bounds above, `bandsPair(inviterId, inviteeId)`, neither block entry exists, and the slot `slotIdFor(inviterId, inviterSlot)` is written in this batch with `whisperId == id`, `userId == inviter`, `openedAt == request.time` (checked with `existsAfter` and `getAfter`).
- **update:** exactly one of four transitions. Each pins which fields may change, using `diff().affectedKeys().hasOnly(...)`.

| Transition | Who | Extra conditions | Fields that change |
| --- | --- | --- | --- |
| accept | invitee | `isPending`; `acceptedAt == request.time`; `inviteeSlot in [1,2,3]`; `bandsPair`; neither block entry; invitee slot written in this batch | `status`, `acceptedAt`, `inviteeSlot` |
| decline | invitee | `status == 'requested'` (stale allowed) | `status` |
| cancel | inviter | `status == 'requested'`; `endedBy == request.auth.uid` | `status`, `endedBy` |
| end | either member | `status == 'accepted'`; `endedBy == request.auth.uid` (allowed after the hour too) | `status`, `endedBy` |

The decline, cancel and end branches read only `resource.data` and `request.resource.data`. They need no lookups. Only accept does.

- **delete:** `false`.

### `whispers/{whisperId}/messages/{messageId}`

- **read:** `isAuthed()`, the parent exists, `isMember(parent)` and `isOpenThread(parent)`. One `get` of the parent. After the hour, after end, before accept, and for a stale invite, reads are denied.
- **create:** the caller is a member, the thread is open, `sentAt == request.time`, the field and value checks above, the sender is not blocked by the other member, the rate limit rule (same `getAfter`, `exists`, `get` pattern as rooms), and `!isInProbation() || hasNoUrl(body)`. The other member is `inviterId` if the sender is the invitee, else `inviteeId`. The block check is `!exists(blockPath(other, request.auth.uid))`. Only that direction is checked, so the blocker can still send.
- **update, delete:** `false`.

### `whispers/{whisperId}/rateLimits/{uid}`

Create and update: `request.auth.uid == uid`, the parent is an open thread and the caller is a member, exact fields, `lastMessageAt == request.time`, `expiresAt` equals the parent's (create) or the stored value (update). Delete: `false`.

### `whisperSlots/{slotId}`

- **get:** the slot ID is the caller's own (`uid_1`, `uid_2` or `uid_3`).
- **list:** `resource.data.userId == request.auth.uid`.
- **create:** own slot ID, exact fields (`userId`, `whisperId`, `openedAt`, `expiresAt`), `userId == uid`, `openedAt == request.time`, and the slot is for a Whisper written in this batch (below).
- **update:** all of the create conditions, plus `request.resource.data.whisperId != resource.data.whisperId`, plus the previous Whisper is over: `!exists(prev) || isOver(get(prev).data)`.
- **delete:** `false`.

"The slot is for a Whisper written in this batch" means: `existsAfter(whisper)` and, with `w = getAfter(whisper).data`, either

- the caller is the inviter, `slotId == slotIdFor(uid, w.inviterSlot)` and `w.createdAt == request.time`; or
- the caller is the invitee, `slotId == slotIdFor(uid, w.inviteeSlot)` and `w.acceptedAt == request.time`;

and in both cases `slot.expiresAt == w.expiresAt`. Because `createdAt` and `acceptedAt` are fixed to `request.time` by the Whisper's own rules and never change afterwards, equality with `request.time` proves the Whisper was written in this same batch. A slot cannot point at an older Whisper.

Each slot document holds one `whisperId`, and the Whisper's create or accept requires the slot's `whisperId` to equal its own ID. So one slot cannot satisfy two Whisper writes in a batch.

### Why the cap holds

A person's open whispers are the pending invites they sent plus the accepted threads they are in. Each one is named by exactly one slot document of that person (`inviterSlot` for the inviter, `inviteeSlot` for the invitee), and that slot's `whisperId` points at it. A slot can be rewritten only when the Whisper it points to is over. Clients cannot delete slots. There are 3 slots per person, so at most 3 open whispers. This limits spam, not a hard guarantee, because a recreated anonymous account has new slots.

### Blocks

- **Invite:** denied if the invitee has blocked the inviter, or the inviter has blocked the invitee.
- **Accept:** denied if either has blocked the other.
- **Message:** denied if the other member has blocked the sender. The blocker can still send.

The block documents are read by the rules with `exists`, so the client never needs to read the other person's block list. Clients cannot read it.

### expiresAt hints

`expiresAt` appears on Whispers, messages, rate limits and slots so that a Firestore TTL policy can clean up. The rules check only that it is a timestamp and, for children, that it equals the parent's value, which is already fetched. No allow decision depends on a stored `expiresAt`. TTL deletion is not instant, so the access windows are enforced by the rules and not by cleanup.

## Lookup budget

Firestore allows 10 document lookups per single-document operation and 20 per batch. The counts below are conservative: each call (`get`, `getAfter`, `exists`, `existsAfter`) on each path is counted once, and no credit is taken for Firestore caching repeated access to the same document. Rules branches that short-circuit are counted as if they ran. The emulator worst-case tests are the proof, not this table.

| Operation | Write | Lookups | Which |
| --- | --- | --- | --- |
| **Invite batch** | Whisper create | 6 | `get` users/inviter, `get` users/invitee, `exists` block (invitee blocked inviter), `exists` block (inviter blocked invitee), `existsAfter` slot, `getAfter` slot |
| | Slot create | 2 | `existsAfter` whisper, `getAfter` whisper |
| | **Batch total** | **8** | |
| **Invite batch, slot reuse** (worst case) | Whisper create | 6 | as above |
| | Slot update | 4 | `existsAfter` whisper, `getAfter` whisper, `exists` previous whisper, `get` previous whisper |
| | **Batch total** | **10** | |
| **Accept batch** | Whisper update (accept) | 6 | `get` users/inviter, `get` users/invitee, 2 block `exists`, `existsAfter` and `getAfter` of invitee slot |
| | Slot create | 2 | `existsAfter` whisper, `getAfter` whisper |
| | **Batch total** | **8** | |
| **Accept batch, slot reuse** (worst case) | Whisper update | 6 | as above |
| | Slot update | 4 | as above |
| | **Batch total** | **10** | |
| **First message** | Message create | 6 | `get` whisper, `get` users/sender (probation), `exists` block (other blocked sender), `getAfter` rate limit, `exists` rate limit, `get` rate limit |
| | Rate limit create | 1 | `get` whisper |
| | **Batch total** | **7** | |
| **Later message** | Message create | 6 | as above |
| | Rate limit update | 1 | `get` whisper |
| | **Batch total** | **7** | |
| **End** | Whisper update | 0 | uses `resource` and `request.resource` only |
| **Decline** | Whisper update | 0 | same |
| **Cancel** | Whisper update | 0 | same |
| Read a message | Message read | 1 | `get` whisper |
| Read or list a Whisper, slot or block entry | | 0 | |

Every single-document operation is at most 6, under 10. Every batch is at most 10, under 20. The tightest single-write count is 6, and the largest batch is 10, so there is headroom of 4 per operation and 10 per batch.

The two worst-case emulator tests are:

1. **Invite batch with slot reuse.** The slot's previous Whisper is planted as an ended thread with the admin context. Both users have a `users` document, no block entries exist, the same age band. Expect success.
2. **First message in a thread.** The sender is in probation and the body has no link, so the probation check runs. No rate limit document exists yet, the Whisper is accepted and open. Expect success.

If either fails with a lookup-limit error, the fallback is to copy `inviterBand` onto the Whisper at create (so accept reads one fewer `users` document) and record the change here. If this fallback is ever used, the create rule MUST enforce `inviterBand == get(users/{inviterId}).data.ageBandLabel`. A client-supplied band is never trusted. The field would join the allowed-field list, would be immutable, and would need its own denial test (a wrong `inviterBand` is denied) with a positive control (the correct `inviterBand` is allowed).

## Known limits

- The age band is self-declared. A person can give a false age at sign-up. The band check is best-effort protection, not a guarantee.
- The cap limits spam, not a hard guarantee. Anonymous accounts can be recreated.
- A block stops new messages, but it does not change the Whisper's `status`. The client also ends the thread when it creates a block. If it does not, the thread stays "accepted" until the hour ends or someone ends it, but the blocked person cannot send.
- Messages are stored in Firestore. They are not end-to-end encrypted. Firestore TTL deletion is not instant, so the rules, not cleanup, make messages unreadable after the thread closes.
- A person who has the other's uid can still try an invite. The rules answer with a plain permission-denied for a block, an age mismatch, or a full slot set.

## Test design

All tests live in new files under `tests/rules`. The existing room, rooms-and-expiry and room-limit tests are not edited and must still pass. Helpers: `tests/rules/helpers.ts` gets one additive helper, an authenticated Firestore for any uid (for example `userDb(uid)`), because the existing helpers only provide `userA` and `userB`. The existing helpers do not change. The age band used by the rules comes from the seeded `users` documents, not from the auth token. A new file `tests/rules/whisperHelpers.ts` holds batch builders and seeders, in the style of `roomLimitHelpers.ts`:

- `inviteBatch(db, opts)`: Whisper create plus inviter slot write, with overrides and omit switches.
- `acceptBatch(db, opts)`: Whisper update plus invitee slot write.
- `messageBatch(db, opts)`: message create plus rate limit write.
- `seedUser(admin, uid, { band, ageSeconds })`, `seedWhisper(admin, id, { status, createdAgeS, acceptedAgeS, ... })`, `seedWhisperSlot`, `seedBlock`, `seedRateLimit`.

Rules for the tests: every test starts with `clearData()` and seeds from empty. Every denial is paired with a positive control that differs in one condition. Expiry cases use backdated planted documents and stay away from the exact boundary (for example 14 minutes versus 16 minutes, 59 minutes versus 61 minutes).

### Example tests, each denial with its control

| Group | Denied case | Matching allowed case |
| --- | --- | --- |
| Invite | different age bands | same band `13_17`, or same band `18_plus` |
| Invite | `under_13` with `under_13` | `13_17` with `13_17` |
| Invite | invitee has blocked inviter | no block |
| Invite | inviter has blocked invitee | no block |
| Invite | fourth open whisper (3 slots held by open threads) | third open whisper |
| Invite | slot ID of another user | own slot ID |
| Invite | `endedBy` or `acceptedAt` set at create | both null |
| Accept | by the inviter, or by a third person | by the invitee |
| Accept | invite 16 minutes old | invite 14 minutes old |
| Accept | age bands now differ (users doc planted differently) | same bands |
| Accept | either member has blocked the other (both directions) | no block |
| Accept | `acceptedAt` not `request.time` | `acceptedAt == request.time` |
| Accept | invitee has 3 open threads | invitee has 2 |
| Cancel and decline | invitee sets `ended` on a pending invite | inviter sets `ended` on a pending invite |
| Cancel and decline | inviter sets `declined` | invitee sets `declined` |
| Transitions | any transition out of `declined`, any out of `ended`, `accepted` to `requested`, `accepted` to `declined` | `accepted` to `ended` by either member |
| Immutability | change of `inviterId`, `memberIds`, `createdAt`, `inviterSlot`, `expiresAt` | the allowed transition |
| Slots | reuse while the thread is open (pending, 14 minutes old, and accepted, 30 minutes old) | reuse after decline, after cancel, after the hour (accepted 61 minutes ago), after a stale invite, and when the previous Whisper no longer exists |
| Slots | read of another person's slot, delete of own slot | read of own slot |
| Message | by a non-member | by a member |
| Message | before acceptance (`requested`) | after acceptance |
| Message | 61 minutes after acceptance | 59 minutes after acceptance |
| Message | thread `ended`, ended by the sender, ended by the other member | `accepted` |
| Message | the other member has blocked the sender | no block |
| Message | the blocker sends while the sender has not blocked them | (this is the positive control for the line above: blocker can still send) |
| Message | body with `http://`, `https://` or `www.` in probation | same text without a link; and a link from an account past probation |
| Message | second message within 3 seconds | second message after a planted rate limit older than 3 seconds |
| Message | body empty, over 280 characters, wrong `senderId`, wrong `messageId` | body of 280 characters |
| Read | non-member read of the Whisper or its messages | member read |
| Read | message read after one hour, after end, before accept | message read while open |
| Read | list without `array-contains` | list with `array-contains` |
| Blocks | read or write of another person's block entry, delete by another person | read, write and delete by the owner (unblock) |
| Delete | delete of a Whisper, message, rate limit or slot | (no positive control exists; the rule is `false`) |

For the delete row, the positive control is that the document is still readable by a member through the admin context afterward, and that the same member can still do an allowed update.

### Lookup-budget tests

The two worst-case tests above run in `whisperBudget.test.ts` and assert success.

### Property tests (fast-check, `numRuns` 20 or fewer)

1. **Message window.** For a generated acceptance age, message time and thread status planted with the admin context, a message is accepted only if the thread is `accepted` and the acceptance age is under one hour. Ages near the boundary are excluded because time cannot be moved.
2. **Age pairing.** For two generated age bands and a generated order of invite and accept, a thread can reach `accepted` only if both bands are equal and not `under_13`. The test also plants bands that differ at accept time, to cover the accept check on its own.
3. **Non-member access.** For a generated whisper status and a non-member uid, every read, list, create, update and delete on the Whisper, its messages and its rate limits is denied.
4. **Cap.** For a generated number of open whispers between 0 and 5 and a generated order, the number of successful invites for one person never exceeds 3.

The plain invariants behind properties 1, 2 and 4 are also checked as pure functions on a small model in a non-emulator test, so the generators can run many more times there. The emulator runs keep the 20-run ceiling.

## Files this spec will touch

| File | Change |
| --- | --- |
| `firestore.rules` | new helpers, `whispers`, `whisperSlots`, and `users/{userId}/blocked` rules; saved as UTF-8 without a BOM, checked by reading the first three bytes |
| `tests/rules/whisper*.test.ts`, `whisperHelpers.ts` | new |
| `tests/rules/helpers.ts` | one additive helper |
| `docs/build-log.md` | one entry |
| `.kiro/steering/safety-and-claims.md` | one bullet |
| `.kiro/hooks/` | one hook that runs `npm run test:emulator` on save of `firestore.rules` or any file under `tests/rules` |
| `firestore.indexes.json` | no change expected; the list query is a single `array-contains` on `memberIds` |

Nothing under `src/` changes.

## Risks

- **Lookup counting.** If Firestore counts differently from the table, the two worst-case tests fail. The fallback is described above.
- **Time boundaries.** Tests cannot sit on the exact boundary. The boundary itself is covered by the rule text (`<` and `>=`), not by a test.
- **Parser sensitivity.** `firestore.rules` is written as UTF-8 without a BOM. The first three bytes are checked after every write, because a BOM broke the emulator parser twice.
- **Ternary in `slotIdFor`.** If the emulator rejects the nested ternary, the fallback is `slotId in [uid + '_1']`-style checks per value of `n`.
