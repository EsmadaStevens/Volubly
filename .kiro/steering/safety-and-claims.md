# Volubly: safety and honest-claims steering

## Safety rules
- Rooms are text-only. No images or files.
- Rate limits per room (for example one message per 3 seconds, set in config).
- Enforcement ladder, applied by code: warning, then timed mute, then timed room ban. No permanent bans from automated rules.
- Appeals go **privately to the affected user**. Bans are confirmed only in a moderator-only view. Never publicly name a flagged user in the feed.
- Report button on every message and room.
- Advice, warning and enforcement are different things: advice ("you might want to reconsider"), warning ("this may break the room rules"), enforcement (a deterministic rule blocks a prohibited message). Do not mix them up.
- If someone is about to share their own phone number, the prompt differs from sharing someone else's.

## Bot-resistance basics
- New accounts have a probation period (default one hour): lower message rate and no links.
- Detect identical or near-identical messages across rooms; code rate-limits them.
- Judge behaviour (age of account, rate, repetition, links), not writing style. Never claim a model can tell AI-written text from human text.
- Show labels like "new account". Never publicly label a person "bot".
- Labelled bots (for example a trivia bot with a visible Bot badge) are allowed. Unlabelled automation is not.
- Room limit: one account can have at most 2 active rooms at a time, enforced in firestore.rules with two slot documents per user. This limits spam, not a hard guarantee: anonymous accounts can be recreated, and a recreated account gets new slots. Never describe it as unbypassable or as preventing all spam.

## Teen protections (minimum)
- Neutral age screen at sign-up. Do not hint at the cutoff age. Store only an age band.
- Under-18 accounts: no contact requests or private threads with adults, 18+/unrated rooms are hidden and not recommended, stricter filters, easy reporting.
- Rooms carry a maturity label set by the host and checked by rules.
- Self-declared age can be false. Never say the app is "child-safe". Say what it does.
- Explain blocked actions to the user in plain words.
- Whisper threads (private chat between exactly two people, open 1 hour after the invitee accepts): the rules
  pair people only when their stored age band matches and is not under 13, at invite and again at accept. The
  age band is self-declared, so this is best-effort protection, not a guarantee. A person can have at most 3
  open whispers; this limits spam, not a hard guarantee, because anonymous accounts can be recreated and get
  new slots. A block stops the blocked person's messages. Only the two people can read a thread through the
  app. It is not end-to-end encrypted. A denied invite looks the same whatever the cause.

## Claims we must NOT make anywhere (UI, README, video, write-ups)
End-to-end encryption, "RAM only / no storage", "zero logs", "IP masked", "100% protected", "hardware verified", "child-safe", unmeasured latency numbers, "no algorithm" (say "no engagement-based feed").
Use true statements instead: "Rooms end after 24 hours", "Only your username and avatar show here", "Checked on your device before it is sent" (only when that is true).

## Content to avoid in demos and sample data
Mental-health rooms with a claimed counsellor, anonymous no-log confession rooms, piracy topics, real brand logos. Plain-text team or broadcaster names are fine. Participants in demo rooms must be clearly labelled as simulated.

## Assets
Own or properly licensed logo, avatar parts, sounds and music only. No copyrighted music in videos. Do not reuse MXit or Moola branding or sounds.