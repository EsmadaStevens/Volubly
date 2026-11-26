# Volubly

**Free, ad-free live chat rooms that close after 24 hours. AI safety checks run on your device first and use the cloud only when needed, with your consent.**

Live app: https://volubly.web.app (best on desktop Chrome with built-in AI; works on phones too)

Volubly is for talking about what is happening right now: rooms are tied to live events or open topics and close after 24 hours. People appear only as a username and an avatar, with no real details shared in rooms.

Built solo in Lusaka, Zambia for the #BuildHybridAI hackathon. Licence: Apache-2.0.

> The AI reads and flags. Code enforces the rules. People decide.

## Try it in 30 seconds

1. Open the live app, pick a username and an adult date of birth (Volubly is for ages 13 and over).
2. Open a room, or start one with **New room**.
3. Type `shut up, nobody asked` and press **Send**. On desktop Chrome with built-in AI, the check runs on your device and you get a review before anything is sent.
4. Open **Ghost-Mode** and read **Inference activity**: it shows where each check ran, how long it took, and why.
5. On a phone, or without the on-device model, tick **Allow a cloud check** in Ghost-Mode to try the cloud route.
6. Want a busy room to play with? Add `/demo` to a room's address (for example `https://volubly.web.app/#room/ROOMID/demo`) for simulated messages. They exist only on your screen: nothing is written to the database and nobody else sees them.

## What it does

- **Live rooms** that close 24 hours after they open. You get a username and an avatar, nothing else. No phone number, no email.
- **Ghost-Mode (safety layer)**
  - *Before you send:* plain code hides phone numbers, emails, passwords and keys. An AI check then looks for insults, threats, hate and similar. If it finds something, you choose: send a redacted version, send anyway, or edit.
  - *When you read:* messages that look harmful, or contain a link, are hidden behind a card that names the category and says the guess may be wrong. One tap shows the message.
  - *Catch-up:* one tap summarises what you missed (the latest 100 messages at most). Real usernames are put back on your device after the summary returns.
  - *Delay Shield:* hold messages back for 30 to 90 seconds so a live stream isn't spoiled.
- Emoji, @mentions, editable profile and backgrounds, an installable PWA, and a wide-screen layout.

## Hybrid inference: where each check runs

Plain code chooses the route for every job, using the job, the device, the connection and your consent. The model never decides where data goes. We use Firebase AI Logic's `ONLY_ON_DEVICE` and `ONLY_IN_CLOUD` modes explicitly instead of automatic fallback, because a silent fallback would send data to the cloud without consent.

| Job | On-device (Chrome built-in AI) | Cloud (Gemini via Firebase AI Logic) |
|---|---|---|
| Check what you send | Used when the model is ready | Only if you tick the consent box. Numbers, emails and keys are already hidden. |
| Read incoming messages | Always | **Never** |
| Catch-up, fewer than 40 new messages | Yes | No |
| Catch-up, 40 or more, or no model on the device | Latest 40 only, when offline | Only after you tap Allow. Names become P1, P2 and so on. |

A catch-up of 3 or fewer messages is not summarised (it's quicker to read). A timeout is shown as "not checked", never as "safe". On phones and browsers without the on-device model, only the plain-code checks run on what you read.

## Built with

React, TypeScript, Vite and Tailwind CSS. Firebase: Authentication (anonymous), Firestore (Africa-Johannesburg), App Check (reCAPTCHA Enterprise), Firebase AI Logic, Hosting. Tests: Vitest, fast-check (property-based) and the Firebase emulator for security rules. No servers and no Cloud Functions.

## Run it yourself

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | >= 20 LTS |
| npm | >= 10 |
| Java | >= 11 (the Firebase Emulator Suite uses it to run the Firestore emulator; get it from [adoptium.net](https://adoptium.net)) |

You also need a Firebase project of your own.

### Setup

```bash
npm install
cp .env.example .env.local   # then fill in your own Firebase web config and reCAPTCHA Enterprise site key
```

### Development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Unit and property tests

```bash
npm test
```

### Security Rules tests (need the Firebase emulator)

Start the Firestore emulator in one terminal:

```bash
npx firebase emulators:start --only firestore
```

Then, in another terminal:

```bash
npm run test:emulator
```

### Build and deploy

```bash
npm run build
npx firebase deploy --only hosting --project <your-project>
```

The on-device route needs desktop Chrome with built-in AI available. The first use downloads the model, then it works offline.

## Limitations, said plainly

- Ghost-Mode can miss harmful messages and hide harmless ones. People stay in control of what they send and show.
- On-device checks need desktop Chrome with built-in AI. Phones get the plain-code checks on what they read; the cloud check, only if allowed, applies to what they send.
- Catch-up summaries come from a small model and can add details that weren't said.
- Rooms close after 24 hours. Automatic deletion of old data is designed but not switched on, because it needs a billing plan.
- Sign-in is anonymous and tied to one browser. Age bands are self-declared.

## Built with Kiro

The `.kiro/` folder holds the steering files (including an honest-claims rule), the specs (for example `whisper-threads`, with requirements, design and tasks), and hooks (such as running the rules tests on save). Property-based tests cover the room and whisper security rules. The build log is in `docs/build-log.md`.

## Roadmap

Private one-hour whisper threads, room descriptions, animated text cards as a moderated alternative to GIFs, a Report button reviewed by a person, optional account linking, reader controls for how strict hiding is, and Remote Config for a cloud kill switch.

## Licence

Apache-2.0. See `LICENSE`.