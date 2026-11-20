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
