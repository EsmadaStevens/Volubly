# Volubly: product steering

Volubly is a free, ad-free web app (installable PWA, mobile-first) for talking about what is happening right now. Inspired by MXit; do not use the names "MXit" or "Moola", or any of their logos or sounds.

## What it is
- **Live Rooms** (tied to an event: a movie, a match) and **Open Topics** (anyone starts one). A room lives 24 hours from the moment it opens, then it is gone.
- In rooms people appear only as **username + avatar**. Real details are visible only to accepted contacts, per their settings. This is always on in rooms; there is no toggle.
- Rooms are text-only.
- Discovery is **not engagement-based**. Rooms are shown by what is live. Default order: live now. The user can switch to ending soon, newest, busiest. "Your picks" (chosen categories) show first, then "Also live" in a separate section. Each room can show why it is listed. Only accounts past probation count toward "busiest".
- AI helps people: a catch-up summary when joining late, a pre-send safety check on the user's own draft, and scam/spam warnings. AI is never the product; the community is.

## Core principle
**The model reads and flags. Code enforces the rules. People decide.** AI never bans, mutes or removes anyone by itself. Code applies defined rules (warning, then timed mute, then timed room ban), the user can appeal privately, and a moderator decides bans.

## Must-work features (in priority order)
1. Accounts (username + avatar, age band) and rooms/topics with 24h expiry
2. Live chat
3. Contacts and privacy settings
4. Report button, rate limits, timed mutes, private appeals
5. Ghost-Mode pre-send check (deterministic rules + AI check)
6. Scam/spam warning and bot-resistance basics
7. AI catch-up summary with an on-device / cloud-assisted / unavailable badge
8. Teen restricted mode
9. Credits (sandbox, in-app only, no cash-out) and a small shop of avatar items and chat colours

## If time remains
Vibe-Shift (few moods, smoothed), one Room Capsule (opt-in, paraphrased, no named top contributor), Data Saver, queued/sent/delivered message states.

## Roadmap only (do not build now)
Translation, Whisper Threads, Relay Capsules, nearby rooms, region badges, scheduled-room notifications, marketplace or payments, real age assurance, phone verification.

## Tone and look
Calm, modern, dark theme, high contrast, minimum 12px text, 44px touch targets. Nostalgia lives in small details (emoticons like :D and ;), a green accent, small original sounds), not in an old-phone look. Use our own logo, avatars and sounds only.