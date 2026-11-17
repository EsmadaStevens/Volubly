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