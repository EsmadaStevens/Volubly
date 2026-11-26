# Design Document

## Overview

A whisper thread is a private chat between two people. It is enforced entirely in `firestore.rules`. There are no Cloud Functions and the project stays on the Spark plan. Part 1 of this design (up to "Risks") changes rules, tests and docs only. **Part 2 (the last section of this file) designs the client under `src/`.**

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

---

# Part 2: Client design

Requirements 12 to 24 define the behaviour. This part says how it is built. Nothing here changes `firestore.rules`.

## Principles

1. **Pure core, thin shell.** Time, inbox sections, slot picking, write plans, error choice and copy are plain TypeScript with no Firebase import. They carry the property tests. Firebase code is limited to two small modules (`whisperApi.ts` and the subscription hooks).
2. **The rules decide; the client explains early.** Pre-checks exist only to give a plain message before a write. A pre-check that is wrong is harmless, because the rules still refuse.
3. **Reuse, do not copy.** The chat is the existing `MessageList`, `MessageItem` and `MessageComposer`, driven by the existing `useGhostCheck` and `useMessageGuard`.
4. **Clear on the client.** Time, an `ended` status and a permission-denied each end the chat view, because open listeners never re-check rules.

## File map

New files (all under `src/`):

| File | Kind | Purpose |
| --- | --- | --- |
| `lib/whisperTypes.ts` | pure | Constants, `WhisperStatus`, `WhisperView`, `SlotNumber` |
| `lib/whisperTime.ts` | pure | `whisperPhase`, time left, `formatCountdown`, `formatInviteLeft` |
| `lib/whisperData.ts` | pure | `toWhisperView` (Firestore data to `WhisperView`, or null when malformed) |
| `lib/whisperInbox.ts` | pure | `buildInbox`, `pendingInviteCount`, `relationWith`, `endActionFor`, `canPickPerson`, `whispersAllowed` |
| `lib/whisperSlots.ts` | pure | `pickSlot` |
| `lib/whisperPlans.ts` | pure | `planInvite`, `planAccept`, `planDecline`, `planCancel`, `planEnd`, `planBlock`, `planUnblock`, `planMessage`, `SERVER_TIME` |
| `lib/whisperCopy.ts` | pure | Every user-facing whisper string |
| `lib/whisperErrors.ts` | pure | `WhisperErrorCode`, `whisperErrorText`, `classifyAcceptFailure` |
| `lib/whisperTarget.ts` | pure | `makeWhisperTarget` (the composer `target`: pre-check, send, error wording) |
| `lib/whisperApply.ts` | Firebase (no `lib/firebase`) | `applyPlan(db, plan)`: the one place a plan becomes a `writeBatch`. It imports `firebase/firestore` only and takes `db` as an argument, so the emulator test can call it with a rules-test Firestore |
| `lib/whisperWrite.ts` | pure | `withTimeout(promise, ms)` and `runGuarded(apply, { online, timeoutMs })`: the offline check and the 10 second limit, with injected dependencies so they can be tested with fake timers |
| `lib/whisperApi.ts` | Firebase | `commit(plan)` (= `runGuarded` around `applyPlan(db, plan)`), `loadMySlots`, `sendInvite`, `acceptInvite`, `declineInvite`, `cancelInvite`, `endWhisper`, `blockPerson`, `unblockPerson`, `hasBlocked`, `sendWhisperMessage` |
| `hooks/useSubscription.ts` | generic | The only place a listener is opened and closed |
| `hooks/useWhispers.ts` | Firebase | The person's whispers (one listener) |
| `hooks/useWhisper.ts` | Firebase | One Whisper document |
| `hooks/useWhisperMessages.ts` | Firebase | One Whisper's messages, enabled only while open |
| `hooks/useCountdown.ts` | time | `useCountdown(endMs)` (1 s tick for the chip) and `useDeadline(endMs)` (flips once at the end) |
| `components/WhispersLink.tsx` | UI | Home link with the pending-invite count |
| `components/InviteCard.tsx` | UI | One invite: avatar, name, time left, Accept, Decline, Decline and block |
| `components/WhisperRow.tsx` | UI | One open or waiting whisper row |
| `components/WhisperHeader.tsx` | UI | Chat header: name, countdown chip, End, End and block |
| `components/PersonSheet.tsx` | UI | Invite dialog opened from a room |
| `pages/WhispersPage.tsx` | page | The Inbox |
| `pages/WhisperPage.tsx` | page | The Whisper_Chat |

Existing files that change (all additive; see "Changes to existing files"): `App.tsx`, `pages/HomePage.tsx`, `pages/RoomPage.tsx`, `components/MessageItem.tsx`, `components/MessageList.tsx`, `components/MessageComposer.tsx`.

New test files: next to each pure module under `src/lib/__tests__`, component tests under `src/components/__tests__`, one hook test under `src/hooks/__tests__`, and one emulator test `tests/rules/whisperClientPlans.test.ts`.

## Time model on the client

Constants in `whisperTypes.ts`: `INVITE_WINDOW_MS = 15 min`, `THREAD_MS = 60 min`, `SLOT_MARGIN_MS = 60 s`, `EXPIRES_HINT_MS = 97.5 min`, `MAX_WHISPERS = 3`.

`whisperPhase(w, nowMs)` returns exactly one of:

| Phase | Condition |
| --- | --- |
| `invite_open` | `status == 'requested'` and `now < createdAt + 15 min` |
| `invite_expired` | `status == 'requested'` and `now >= createdAt + 15 min` |
| `open` | `status == 'accepted'`, `acceptedAt` set, `now < acceptedAt + 1 h` |
| `time_up` | `status == 'accepted'` and `now >= acceptedAt + 1 h` (or `acceptedAt` missing) |
| `declined` | `status == 'declined'` |
| `ended` | `status == 'ended'` |

The comparison is `<` for open and `>=` for over, the same as the rules. The client clock is used with no margin for what the person sees (the chat clears at the client's idea of the hour), and with a 60 second margin only where a wrong guess would cause a denied write (slot reuse). Server timestamps that are still pending are read with `serverTimestamps: 'estimate'`, as the room hooks do.

`formatCountdown(ms)` returns `mm:ss` from a non-negative value (a negative value is shown as `00:00`). `formatInviteLeft(ms)` returns "14 min left" or "Under a minute left".

## Types

```ts
type SlotNumber = 1 | 2 | 3
type WhisperStatus = 'requested' | 'accepted' | 'declined' | 'ended'

interface WhisperView {
  id: string
  inviterId: string
  inviteeId: string
  status: WhisperStatus
  createdAtMs: number
  acceptedAtMs: number | null
  endedBy: string | null
  inviterSlot: SlotNumber
  inviteeSlot: SlotNumber | null
  expiresAt: Timestamp        // kept as received: slots and messages must copy it exactly
}
```

`toWhisperView` returns null for a document with a missing or wrong-typed field, so a malformed document is skipped, as `toMessageView` does.

## Inbox model (pure)

```ts
buildInbox(whispers, uid, nowMs) => { invites: WhisperView[]; open: WhisperView[]; waiting: WhisperView[] }
pendingInviteCount(whispers, uid, nowMs) => number
relationWith(whispers, uid, otherUid, nowMs) => { kind: 'none' }
  | { kind: 'open' | 'sent' | 'received'; id: string }
endActionFor(w, uid) => 'decline' | 'cancel' | 'end' | null
```

- `invites`: `phase == 'invite_open'`, `inviteeId == uid`, sorted by `createdAtMs` ascending (soonest to expire first).
- `open`: `phase == 'open'`, sorted by `acceptedAtMs` ascending (soonest to end first).
- `waiting`: `phase == 'invite_open'`, `inviterId == uid`, sorted by `createdAtMs` descending.
- `relationWith` looks for a live (`invite_open` or `open`) whisper between the two people in either direction, so the Person_Sheet can link to it instead of inviting again.
- `canPickPerson({ senderId, uid, simulated, viewerBand })` is true only for a real message from someone else when the viewer's band is not `under_13`. `MessageList` and `RoomPage` both use it, so the Person_Sheet cannot open for a demo sender.
- `whispersAllowed(band)` is false for `under_13`. The Home link, the Inbox gate and the chat gate use it.
- `endActionFor`: `requested` and invitee gives `decline`; `requested` and inviter gives `cancel`; `accepted` and a member gives `end`; anything else gives null. This mirrors the four rule transitions.

## Slot picking (pure)

```ts
interface SlotDoc { n: SlotNumber; whisperId: string }
pickSlot(slots: SlotDoc[], whispers: WhisperView[], nowMs): SlotNumber | null
```

For each n in 1 to 3: no slot document gives rank `-Infinity` (never used, best). A slot whose Whisper is not in `whispers` gives rank 0 (free, treated as cleaned up). A slot whose Whisper is over (declined, ended, a requested one past 15 min plus 60 s, an accepted one past 1 h plus 60 s) is free with rank equal to that Whisper's `createdAtMs` (oldest first). A slot whose Whisper is not over is busy. Return the lowest rank, ties broken by the lower n, or null when all three are busy.

The margin means the client calls a slot busy for up to 60 seconds longer than the rules do. That costs a short wait and never a denied write. If the loaded list is stale and the pick is wrong, the rules deny and the person sees the generic error (Requirement 15.5).

## Write plans (pure)

A plan is a list of operations. Values may be the marker `SERVER_TIME`, which `commit` turns into `serverTimestamp()`.

```ts
type Op =
  | { kind: 'set' | 'update'; path: string[]; data: Record<string, PlanValue> }
  | { kind: 'delete'; path: string[] }
```

| Action | Operations | Rules branch it must satisfy |
| --- | --- | --- |
| Invite | `set whispers/{wid}` with all ten fields (`createdAt` = SERVER_TIME, `acceptedAt` null, `endedBy` null, `inviteeSlot` null, `memberIds` = `[uid, inviteeId]`, `expiresAt`); `set whisperSlots/{uid}_{n}` with `userId`, `whisperId`, `openedAt` = SERVER_TIME, `expiresAt` = the same value | `whisperCreateOk` and `validWhisperSlot` |
| Accept | `update whispers/{wid}` with `status`, `acceptedAt` = SERVER_TIME, `inviteeSlot`; `set whisperSlots/{uid}_{n}` as above with the Whisper's own `expiresAt` | `isAccept` and `validWhisperSlot` |
| Decline | `update whispers/{wid}` with `status: 'declined'` | `isDecline` |
| Cancel | `update` with `status: 'ended'`, `endedBy: uid` | `isCancel` |
| End | `update` with `status: 'ended'`, `endedBy: uid` | `isEnd` |
| Block | `set users/{uid}/blocked/{other}` with `blockedId`, `blockedAt` = SERVER_TIME; plus the decline, cancel or end operation when `endActionFor` is not null | `validBlock` |
| Unblock | `delete users/{uid}/blocked/{other}` | block delete rule |
| Message | `set whispers/{wid}/messages/{mid}` with the six fields (`sentAt` = SERVER_TIME, `expiresAt` = the Whisper's); `set whispers/{wid}/rateLimits/{uid}` with `userId`, `lastMessageAt` = SERVER_TIME, `expiresAt` | `whisperMessageOk` and the rate-limit rules |

Using `set` on a slot or a rate-limit document that already exists is an update in Firestore, and the rules' update branch accepts it. This is the same pattern `sendMessage` uses for room rate limits.

`applyPlan(db, plan)` in `whisperApply.ts` turns a plan into one `writeBatch`, mapping `SERVER_TIME` to `serverTimestamp()`, and commits it. It does not import `lib/firebase`; `db` is a parameter. `commit(plan)` in `whisperApi.ts` calls `runGuarded(() => applyPlan(db, plan), ...)`. The emulator contract test calls the same `applyPlan` with a rules-test Firestore, so the test runs the real conversion and cannot drift from the client. Because every plan is pure data, the property tests check the field sets against the rules' lists.

### Offline and queued writes

The web SDK does not reject a batch while the device is offline. It queues the write and the commit promise stays pending. `runGuarded` therefore does two things before and around every write:

1. If `navigator.onLine === false`, return `generic` at once and write nothing (the same check `sendMessage` makes for "offline").
2. Otherwise race the commit against a 10 second timer (`WRITE_TIMEOUT_MS`). On timeout return `generic`. The timer is cleared as soon as the commit settles.

A write that timed out is still in the SDK's queue and may be applied later. The live whisper list then shows the result. If the person retries before that, the retry can be denied, and the re-reads below sort it out. The re-reads use the same timeout, and each one is a single `getDoc`.

### Unclear results

- **Invite.** The whisper id is made once per sheet and reused. After any failure (denied, timeout, offline) the client re-reads `whispers/{id}` once, before showing an error. If it exists with `status == 'requested'` and `inviterId == uid`, the sheet shows "Invite sent". Otherwise the generic error. A re-read of a missing document throws permission-denied under these rules, which is treated as "not there".
- **Accept.** After any failure the client re-reads the Whisper. `accepted` with the viewer as invitee means the first attempt went through, so the client opens the whisper. Stale or no longer `requested` gives "This invite expired." Anything else gives the generic error.

## Errors (pure)

```ts
type WhisperErrorCode = 'too_many' | 'invite_expired' | 'generic'
whisperErrorText(code): string
classifyAcceptFailure(reread: WhisperView | null, uid: string, nowMs): 'accepted' | 'invite_expired' | 'generic'
classifyInviteFailure(reread: WhisperView | null, uid: string): 'sent' | 'generic'
```

- `too_many` comes only from `pickSlot` returning null.
- `invite_expired` comes from the client-clock pre-check, or from `classifyAcceptFailure` after a failure: the re-read Whisper is stale, or its status is no longer `requested` (and it is not an accept by the viewer that already went through, which gives `accepted`).
- `generic` is everything else, including offline, a block, an age mismatch, a full slot set the client did not see, and a stale pick.

Message sending is separate: `whisperTarget.ts` maps the existing `SendErrorCode` values. `room_closed` becomes "This whisper has ended, so messages can no longer be sent." and the rest use `explainSendError` unchanged.

## Copy (pure)

All strings live in `whisperCopy.ts`. The test scans every exported string for the forbidden words in Requirement 21.5 and for words that would reveal a cause (Requirement 20.4). The main strings:

| Where | Text |
| --- | --- |
| Too many | You have too many whispers open. End one or wait for one to finish, then try again. |
| Expired | This invite expired. |
| Generic | That didn't work. Check your connection and try again. |
| Inbox empty | No whispers right now. Tap a name in a room to invite someone. |
| Inbox error | We couldn't load your whispers. Check your connection and try again. |
| Sections | Invites for you, Open whispers, Waiting for a reply |
| Invite sent | Invite sent. {name} has 15 minutes to accept. |
| Sheet note | Whispers work between people in the same age group. Not every invite can be sent. |
| Chat note | Only you and {name} can read this in the app. It ends 1 hour after it was accepted. |
| Ended | This whisper has ended. |
| Unavailable | This whisper isn't available. |
| End confirm | End this whisper? / End / Keep chatting |
| Block result | You blocked {name}. |
| Under 13 | Whispers aren't available for this account. |
| Send closed | This whisper has ended, so messages can no longer be sent. |

## Subscriptions

```ts
type SubState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'denied' }
  | { status: 'error'; message: string }

useSubscription<T>(
  open: ((emit: (s: SubState<T>) => void) => () => void) | null,
  deps: unknown[],
): { state: SubState<T>; retry: () => void }
```

`open` is called in an effect and returns the Firestore unsubscribe function. The effect cleanup calls it, resets the state, and sets a cancelled flag so a late snapshot is dropped. `open == null` gives `idle`, and the effect opens nothing. `retry` bumps an attempt counter that is part of the deps.

| Hook | Query | Notes |
| --- | --- | --- |
| `useWhispers(uid \| null)` | `query(collection(db, 'whispers'), where('memberIds', 'array-contains', uid))` | Maps docs with `toWhisperView`, skips nulls. No `orderBy`, so no index. `null` uid (an `under_13` account) opens nothing. |
| `useWhisper(id)` | `doc(db, 'whispers', id)` | Missing document and permission-denied both give `denied` ("not available"). |
| `useWhisperMessages(id, enabled)` | `query(collection(db, 'whispers', id, 'messages'), orderBy('sentAt', 'asc'), limitToLast(200))` | `enabled == false` opens nothing and returns the `closed` state. Result type is the existing `MessagesState`. Documents map through the existing `toMessageView`. |

Listener inventory (each gives its reads back when unmounted):

| Screen | Listeners |
| --- | --- |
| Home | whispers (for the link count) |
| Inbox | whispers |
| Whisper_Chat | one Whisper; messages only while open |
| Room with Person_Sheet open | whispers, only while the sheet is mounted |

`useCountdown(endMs)` ticks once a second and returns the milliseconds left, computed from the device clock each tick. It is used only by the small header chip. `useDeadline(endMs)` returns a boolean that flips once. It uses a single `setTimeout` for the time left (the longest wait is one hour, well under the timer limit) and also re-checks `Date.now() >= endMs` on `visibilitychange` (when the page becomes visible) and on window `focus`, because one timer fires late after the device sleeps or a background tab is throttled. All three listeners and the timer are removed on unmount. The check itself is a pure function `deadlinePassed(endMs, nowMs)` so it can be tested. The page uses `useDeadline`, so the page re-renders once at the end and the chip re-renders each second.

All three data hooks read documents with `data({ serverTimestamps: 'estimate' })` and map them through `toWhisperView` or `toMessageView`.

## Screens

### Inbox (`pages/WhispersPage.tsx`)

State comes from `useWhispers(uid)` and `useNow()`. `buildInbox` runs in a `useMemo` keyed on both. Rows:

- `InviteCard` (invite): avatar and username from `useProfiles`, time left, and three buttons: Accept, Decline, Decline and block. Each button is `min-h-[44px]`. The card keeps its own `busy` and `error` state. Accept runs: client-clock check, `loadMySlots`, `pickSlot`, `acceptInvite`. On `ok` it sets `window.location.hash = '#whisper/' + id`.
- `WhisperRow` (open): the other person's avatar and name, time left, link to `#whisper/{id}`.
- `WhisperRow` (waiting): the invitee's name, time left, a Cancel button, and a link.

States: loading text, error (`role="alert"` plus Try again), empty, or the sections.

### Gate for under-13 accounts

`WhispersPage` and `WhisperPage` are thin wrappers. The wrapper checks `whispersAllowed(session.ageBand)` and returns the notice "Whispers aren't available for this account." with a link to `#` when it is false. Only when it is true does it render the inner component that calls `useWhispers` or `useWhisper`. Hooks cannot be called conditionally, so the split is what guarantees that no listener opens for that account. The test stubs the data hooks with `vi.mock` and checks they are not called for an `under_13` session.

### Whisper_Chat (`pages/WhisperPage.tsx`)

```
WhisperPage(id, session)
  whisper = useWhisper(id)                       // listener 1
  other   = the member who is not session.uid
  phase   = whisperPhase(view, now)              // now from useNow, plus useDeadline for the open end
  switch:
    denied or missing  -> Notice "This whisper isn't available."
    invite_open        -> InviteResponse (invitee: Accept/Decline) or WaitingNotice (inviter: Cancel)
    invite_expired     -> Notice "This invite expired."
    declined/ended/time_up -> Notice "This whisper has ended."
    open               -> OpenChat
OpenChat
  ended = useDeadline(acceptedAtMs + THREAD_MS)  // flips once at the end of the hour (also on focus and visibility)
  forcedEnd = state set by target.onClosed       // a send was denied near the hour mark
  if ended or forcedEnd -> Notice "This whisper has ended."   // unmounts list, composer, listener
  msgState = useWhisperMessages(id, true)        // listener 2, only here
  hidden   = useMessageGuard(messages, uid)      // reader check, on-device only
  ghost    = useGhostCheck()
  <WhisperHeader/> <MessageList/> <MessageComposer target=.../>
```

Because `OpenChat` is a separate component that only exists in the `open` phase, anything inside it (the messages listener, the message array, the composer and its draft, the hidden-message state) is dropped by React when the phase leaves `open`. `useWhisperMessages` also maps a permission-denied to `closed`, and `OpenChat` turns `closed` while the document still says open into the ended view (Requirement 17.6).

`WhisperHeader` shows the avatar, name, the countdown chip (`role="timer"`, text `mm:ss left`), and End and End and block buttons. Choosing either shows an inline confirm row instead of a modal (End and Keep chatting; End and block and Keep chatting). The chip is its own component, so a one-second tick does not re-render the list.

The Delay Shield, catch-up bar and unseen count are not used. `MessageList` receives an empty `held` map.

On wide screens `RoomPage` shows `GhostStatus` in an aside. The composer's own `GhostStatus` is `lg:hidden`, so `WhisperPage` renders `<div className="hidden lg:block"><GhostStatus ghost={ghost} compact /></div>` above the composer. This keeps the AI badge visible at every width. The consent checkbox ("Allow a cloud check when this device can't do it...") is inside `GhostStatus`, so the whisper composer shows exactly the same consent line as the room composer, in both the composer's copy and the wide-screen copy. The consent value is the one stored by `useGhostCheck`, shared with rooms.

### Person_Sheet (`components/PersonSheet.tsx`)

Props: `{ person: string; session: ReadySession; onClose: () => void }`, where `person` is the other person's uid. It reads the person's profile with `useProfiles([person])`, the person's whispers with `useWhispers(session.uid)`, and checks `hasBlocked(session.uid, person)` once with `getDoc`. State is chosen by a pure function:

```ts
personSheetState({ blocked, loaded, relation, sent, sending, error }) =>
  'loading' | 'blocked' | 'existing' | 'ready' | 'sending' | 'sent' | 'failed'
```

The whisper id is created once with `doc(collection(db, 'whispers')).id` when the sheet mounts and kept in a ref, so a retry reuses it. After a send the sheet shows the "Invite sent" text and a link to `#whispers`.

### Home link (`components/WhispersLink.tsx`)

Renders nothing when the viewer's band is `under_13`. Otherwise it calls `useWhispers(uid)` and renders an anchor to `#whispers` (44px high) with the count from `pendingInviteCount`. The accessible name is "Whispers" or "Whispers, N invites".

## Changes to existing files

All are additive and keep current behaviour when the new props are absent.

| File | Change |
| --- | --- |
| `App.tsx` | Two regex branches before the room branch: `^#whispers$` and `^#whisper\/([A-Za-z0-9]+)$`. |
| `pages/HomePage.tsx` | Render `<WhispersLink/>` in the header, next to the profile button. |
| `components/MessageItem.tsx` | New optional prop `onNameClick?: () => void`. When present (and the message is not the reader's own) the name is rendered as a `button` with an expanded tap area (`relative` plus a pseudo-element reaching 44px) and `aria-label="Open {name}"`. Otherwise the same `span` as now. |
| `components/MessageList.tsx` | New optional props `closedText`, `emptyText` (defaults are today's strings) and `onPickPerson?: (senderId: string) => void`. It passes `onNameClick` to `MessageItem` only for messages that are not simulated and not the reader's own. |
| `components/MessageComposer.tsx` | New optional `target?: ComposerTarget`. See below. |
| `pages/RoomPage.tsx` | One `useState<string \| null>` for the person being viewed, `onPickPerson` passed to `MessageList` (unless the viewer is `under_13`), and `<PersonSheet/>` rendered when set. |

`MessageComposer` and the target:

```ts
interface ComposerTarget {
  preCheck: (body: string, lastSentAtMs: number | null) => SendErrorCode | null
  send: (i: { messageId: string; body: string; lastSentAtMs: number | null }) => Promise<SendResult>
  explain: (code: SendErrorCode) => string
}
```

The composer's props become a union: either the current room props (`roomId`, `openedAtMs`, `expiresAt`), or `target` (and then the room props are not needed). Inside the composer there are three branches, and each one falls back to today's code when `target` is absent: the pre-check in `submit` (`target ? target.preCheck(text, lastSent.current) : preCheckSend(...)`), the send in `doSend` (`target ? target.send(...) : sendMessage(...)`), and the error wording (`(target?.explain ?? explainSendError)(result.code)`). The rest of the composer (review panel, mentions, emoji, cool-down, wake note, Ghost status) is untouched. Neither `sendMessage.ts` nor `messageUtils.ts` changes.

`makeWhisperTarget({ whisper, uid, createdAtMs })` builds:

- `preCheck`: empty, over 280 characters, faster than 3 seconds since the last send, a link while `inProbation(createdAtMs, now)`, and `now >= acceptedAtMs + THREAD_MS` as `room_closed`. It reuses `containsLink` and `inProbation` from `messageUtils`.
- `send`: calls `sendWhisperMessage` (a `commit(planMessage(...))`). On permission-denied it runs the existing `resolveDenied` with a `readMessage` that reads the message back, so a retried message that already went through counts as sent.
- **Near the hour mark.** `makeWhisperTarget` also takes `onClosed: () => void`. When a send fails and `nearHourMark(whisper, nowMs)` is true (the device clock is within 60 seconds before or after `acceptedAt + THREAD_MS`), `send` calls `onClosed()` and returns `{ status: 'failed', code: 'room_closed' }`. `OpenChat` passes an `onClosed` that sets a local `forcedEnd` flag, and the page then shows the ended view exactly as if the deadline had flipped. The failure is not shown as a generic error. `nearHourMark` is a pure function with its own tests.
- `explain`: `room_closed` gives the whisper text; everything else is `explainSendError`.

## Ghost-Mode wiring

| Step | Part used | Whisper change |
| --- | --- | --- |
| Draft redaction | `redact` inside `useGhostCheck.review` | none |
| Sender check | `useGhostCheck.review`: on-device, or cloud with consent | none (shared consent) |
| Review panel | `ReviewPanel` in `MessageComposer` | none |
| Reader check | `useMessageGuard(messages, uid)`: patterns plus on-device model | none (never cloud) |
| Hidden cards | `MessageItem` | none |
| Status badge | `GhostStatus` | shown at every width (see above) |

## Reads and cost on the Spark plan

- The whispers listener reads every whisper the person is in on first load, including finished ones until a TTL policy removes them (Requirement 12.5, open point 8). A person can hold at most 3 open whispers, and each finished thread is one small document, so the first read stays small for a normal account.
- Later snapshots charge only the changed documents.
- Slot reads (at most 3) and block checks (1) happen only when the person acts.
- Messages read at most 200 documents per open thread.
- The Home link, the Inbox and an open Person_Sheet each have their own listener, but they are never mounted together on one screen except the sheet over a room, which has no Home link.

## Test design (Part 2)

| Module | Examples | Properties (fast-check) |
| --- | --- | --- |
| `whisperTime` | each phase at 14 and 16 minutes, 59 and 61 minutes; countdown text | exactly one phase; `open` iff accepted and inside the hour; countdown never negative and non-increasing |
| `whisperData` | valid document; missing and wrong-typed fields give null | random junk never throws |
| `whisperInbox` | the three sections; sorting; relation; endActionFor for every role and status | no ended, declined or stale item listed; invites never include the person's own sends; sorted |
| `whisperSlots` | missing slot; gone whisper; each over state; each busy state; margin | never returns a busy slot; null exactly when all busy; prefers never-used |
| `whisperPlans` | each plan's exact fields and paths | field sets equal the rules' lists; slot `expiresAt` equals the Whisper's; slot named by the Whisper; message plan includes rate limit |
| `whisperErrors`, `whisperCopy` | the two exact texts; classify after a re-read (accepted, stale, no longer requested, missing; invite sent, not sent) | forbidden-word scan over every string; only two specific texts |
| `whisperWrite` | offline writes nothing; a never-settling commit gives the generic error after 10 s (fake timers); a settled commit clears the timer; a rejected commit gives the generic error | the result is `generic` for any rejection or timeout |
| `whisperTarget` | pre-check cases; closed wording; a failed send within 60 s either side of the hour calls `onClosed` and returns `room_closed`; a failed send 5 minutes away does not | `nearHourMark` is symmetric around the hour mark; link only blocked in probation |
| `deadlinePassed` | before, at and after the end | monotone in time |
| `useSubscription` | mount and unmount runs the unsubscribe once; deps change unsubscribes the old one; a late snapshot after unmount is ignored (uses `react-dom/client` and `act`; `jsdom` 25.0.1 is installed and is the test environment) | none |
| `canPickPerson`, `whispersAllowed` | simulated sender gives false; own message gives false; `under_13` viewer gives false | none |
| Components (static render) | `InviteCard`, `WhisperRow`, `WhisperHeader`, `PersonSheet` states, `MessageItem` with and without `onNameClick`, the chat views per phase, empty, loading and error states | none |
| Emulator contract | every plan, run through the client's own `applyPlan`, accepted by the real rules; wrong slot, wrong field and extra field variants denied | none |

Component tests import modules that reach `lib/firebase.ts` only through `MessageList`, `MessageComposer`, `WhisperPage`, `PersonSheet` and `InviteCard`. Those tests stub it with `vi.mock('../../lib/firebase', () => ({ db: {}, auth: {} }))`, the same way the pure modules avoid the import in the first place. The presentational pieces take plain props, so most tests need no stub.

## Risks (Part 2)

- **Wrong slot pick from stale data.** The result is a generic denial and a retry. The 60 second margin keeps the common case (a thread that just ended) from failing.
- **Device clock far off.** The countdown and the early "expired" message follow the device clock, while the rules follow the server. A clock that runs ahead clears the chat early. A clock that runs behind ends in a permission-denied on the messages listener, which the chat treats as ended. The `expiresAt` hint is centred in its allowed window to tolerate about 20 minutes of drift on invite.
- **Composer change touches the room send path.** The `target` branches fall back to the current code, no room file other than the composer changes, and the existing tests plus a render test for a room composer guard it. A manual room send check is part of the final task.
- **A whisper document removed by TTL while a slot still names it.** Treated as free. The rules already reuse such a slot.
- **First read size.** See "Reads and cost". If it ever matters, a `limit` with a client filter is not safe (no order), so the fix would be a TTL policy, not a query change.
- **Queued writes after a timeout.** A write that timed out may still be applied later. The person sees the generic error, then possibly the result appears in the live list. For an invite, the re-read and the shared whisper id make a retry safe. For an end or a block, repeating the action is harmless: a second end is denied (the thread is already over) and the screen already shows the ended state.
- **A re-read of a missing whisper throws permission-denied under these rules.** Every re-read treats permission-denied as "not there".
- **Rules not deployed.** The client cannot be tried against the real project until the Part 1 rules are deployed. This spec does not deploy.
