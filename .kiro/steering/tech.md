# Volubly: tech steering

Status: proposed. Confirm after the day-1 Firebase spike (see "Spike" below).

## Stack
- Web app, mobile-first, installable as a PWA. TypeScript throughout.
- Vite + React + Tailwind CSS.
- Firebase: Authentication, Firestore, App Check, Hosting, and **Firebase AI Logic (hybrid inference)**.
- Tests: Vitest for unit tests, **fast-check for property-based tests**, Firebase Emulator Suite for Firestore security rules tests.
- Repo is public with an Apache-2.0 licence. The `/.kiro` folder is committed and must never be in `.gitignore`.

## AI rules (hard requirements)
- **All AI inference goes through Firebase AI Logic.** Never call any other model API directly (Hybrid hackathon rule).
- Routing is capability-based: use the on-device model when available, otherwise fall back to the cloud through the same SDK.
- Every AI result shows a status badge: on-device, cloud-assisted, or unavailable. If the SDK cannot tell us which path ran, say so and show only what we can prove.
- Cloud use that sends user content needs consent for that task. Consent to one task is not consent to upload a whole conversation.
- Never write "zero data". Write "no cloud inference request for this task".
- Deterministic rules come first (for example phone-number patterns). The model adds a semantic check on top. The model only flags; code decides the action.
- Sentiment (Vibe-Shift) is never used for moderation decisions.

## Data and expiry
- Messages live in Firestore. Do not claim "RAM only", "no logs" or "end-to-end encrypted".
- A room is open for 24 hours from its opening time. Firestore TTL deletion is not instant, so **security rules and server-side checks must also reject writes to an expired room**. Verify TTL behaviour in the docs.
- Messages carry a client-generated unique ID so retries cannot create duplicates.
- Store only an **age band** (under 13, 13-17, 18+), never a birth date.

## Quality bar
- Property-based tests for every rule listed in the specs (expiry, mutes, bans, probation, minors, credits, privacy).
- Each feature starts as a Kiro spec (requirements, design, tasks) before code.
- Keep a short build log in `docs/build-log.md` as we go; it feeds the Kiro write-up.

## Spike (day 1, before any feature work)
1. Create the Firebase project. Enable Auth, Firestore, Hosting, AI Logic. Set up App Check with a debug token.
2. Send one hybrid prompt through Firebase AI Logic.
3. Confirm whether the on-device model actually runs on the dev machine, and whether the SDK reports which path ran.
4. Test with the network off after the model is downloaded.
Record the results in `docs/build-log.md`. They decide the platform and the demo.