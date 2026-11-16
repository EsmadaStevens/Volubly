# Volubly

Volubly is a free, ad-free web app (installable PWA, mobile-first) for talking about what is happening right now. Rooms are tied to live events or open topics, last 24 hours, and disappear. People appear only as a username and avatar — no real details shared in rooms.

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | >= 20 LTS |
| Java | >= 11 (required by Firebase Emulator Suite) |
| npm | >= 10 |

Install Java from [adoptium.net](https://adoptium.net) if not already present. The Firebase Emulator Suite uses Java to run the Firestore emulator.

## Setup

```bash
npm install
```

## Run unit tests

```bash
npm test
```

## Run Security Rules property tests (requires Firebase Emulator)

Start the Firestore emulator in one terminal:

```bash
npx firebase emulators:start --only firestore
```

Then in another terminal:

```bash
npm run test:emulator
```

## Development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Stack

- Vite + React + TypeScript
- Tailwind CSS
- Firebase (Auth, Firestore, App Check, Hosting)
- Vitest + fast-check for property-based tests
- Firebase Emulator Suite for Security Rules tests

## Licence

Apache-2.0
