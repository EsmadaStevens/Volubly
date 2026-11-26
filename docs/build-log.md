# Build log

## 2026-11-16
- Scaffolded the app with Kiro (Vite, React, TypeScript, Tailwind, Vitest, fast-check).
- Kiro wrote firestore.rules. A UTF-8 BOM made the emulator reject the file twice. Fixed by saving as plain UTF-8.
- Emulator harness running. Smoke test passes.
- Tightened rules by hand: participant docs readable only by their owner, single-room reads require an open room.
- Kiro free credits ran out. Waiting on the Kiroween credit grant.

## 2026-11-17: Firebase AI Logic spike
- On-device model (Chrome, Gemini Nano) downloaded: 4 GB. Device capable: true.
- SDK reports the path on every response: on_device or in_cloud.
- On-device: about 12 s on first run after page load, about 1 s after that.
- Cloud: about 2.3 s when warm. Needed App Check (debug token) before it would answer.
- Offline: on-device still answers. Cloud fails after about 16 s.
- Decisions: warm the model after sign-in, check connectivity before a cloud call,
  ask the model for a verdict and category only and let code supply the message.

## 2026-11-20: Room limit (room-limit spec)
- Each account can have at most 2 active rooms. Enforcement is in `firestore.rules` only: each user has two slot documents, `roomSlots/{uid}_1` and `roomSlots/{uid}_2`, and a room can only be created in the same batch as a slot write.
- No Cloud Functions are used and the project stays on the Spark plan.
- The limit limits spam, not a hard guarantee: anonymous accounts can be recreated, and a recreated account gets new slots.
- The real client `createRoom` is denied by the new rules until it is updated to write the room and a slot in one batch. This is expected. The client update is separate work.
- Latest emulator run: 3 files, 44 tests passing, including the two required fast-check properties (numRuns 20).
## 2026-11-20: Whisper threads (whisper-threads spec)
- Kiro generated the spec (requirements, design with a lookup-count table, task list), the rules for `whispers`, `whisperSlots`, whisper messages, rate limits and `users/{uid}/blocked`, and the emulator tests under `tests/rules` (example tests per area, a lookup-budget file, four fast-check properties, and a pure-model invariants file).
- A whisper thread is a private chat between two people. A pending invite can be accepted for 15 minutes. After acceptance the thread is open for 1 hour, computed from `acceptedAt`. `expiresAt` is only a cleanup hint and no rule trusts it.
- Enforcement is in `firestore.rules` only. No Cloud Functions are used and the project stays on the Spark plan. Nothing was deployed.
- The age band is self-declared. The rules pair people only when the stored bands match and are not under 13, at invite and at accept. That is best-effort protection, not a guarantee.
- A person can have at most 3 open whispers, using slot documents `whisperSlots/{uid}_{n}`. This limits spam, not a hard guarantee: anonymous accounts can be recreated, and a recreated account gets new slots.
- Design change made for the lookup budget: the Whisper carries `inviterSlot` and `inviteeSlot`, so the rules check one slot instead of trying three. Worst-case batches count 10 of 20 lookups, and the worst-case tests pass.
- A block stops messages from the blocked person in a thread. Denied invites, accepts and messages all look like a plain permission-denied.
- Only the two people can read a thread through the app. It is not end-to-end encrypted. Messages are stored in Firestore.
- Mutation check: five deliberate rule breaks (block check on messages, band check at accept, slot reuse condition, one-hour limit, slot match at accept). Four were caught at once. Removing the slot-side "slot id must match the named slot" clause left every test green, so two tests were added (an extra slot for the same Whisper in an invite batch and in an accept batch). The accept variant catches it.
- The real client is not updated by this spec. The client is built separately.
## 2026-11-26: Whisper threads: client (whisper-threads spec, Part 2)
- Task 10: Kiro added the whisper types, the time model (phase, invite and thread time left, countdown text) and the Firestore-to-view mapping under src/lib, with example and fast-check tests. These are plain TypeScript with no Firebase import at run time. Nothing is wired into the screens yet. Nothing was deployed.
- Task 11: Kiro added the inbox model (invites for you, open whispers, waiting invites, sorted on the client because the query has no order), the helpers that pick which action the rules allow and who may be invited, and the slot picker (never returns a busy slot, 60 second safety margin). Plain TypeScript with example and fast-check tests. Nothing is wired into the screens yet.
- Task 12: Kiro added all whisper wording in one file and the error logic. Only two specific errors exist (too many whispers, invite expired), chosen from what the client knows. Everything else shows one generic message, so a block, an age mismatch or a full slot set on the other side look the same. Tests scan every string for forbidden words (deleted, encrypted, safe and similar) and the error texts for cause words.
