import type { MessageView, PublicProfile } from '../types'

/**
 * Demo mode only. These messages are made up on this screen to show the app under load.
 * They are never written to the database and nobody else can see them.
 */
export const SIM_PROFILES: Record<string, PublicProfile> = {
  'sim-a': { username: 'Sim_Ana', avatarSeed: 'sim-ana' },
  'sim-b': { username: 'Sim_Ben', avatarSeed: 'sim-ben' },
  'sim-c': { username: 'Sim_Chipo', avatarSeed: 'sim-chipo' },
  'sim-d': { username: 'Sim_Dumi', avatarSeed: 'sim-dumi' },
  'sim-e': { username: 'Sim_Eli', avatarSeed: 'sim-eli' },
}
const SIM_IDS = Object.keys(SIM_PROFILES)

export const isSimId = (uid: string) => uid in SIM_PROFILES

const CHATTER = [
  'kick off in two minutes, who else is watching?',
  'my stream is about 40 seconds behind, no spoilers please',
  'the keeper looks nervous already',
  'that first tackle was late, was it not?',
  'ref is letting everything go so far',
  'what a ball over the top!',
  'offside surely?',
  'the flag stayed down, play on',
  'the replay shows he was level',
  'VAR is taking forever',
  'they are checking the line now',
  'my money says it gets disallowed',
  'still checking...',
  'decision: goal stands',
  'that is harsh on the defenders',
  'honestly I thought the flag would go up',
  'I would have given the foul at the start of that move',
  'the crowd is loud tonight',
  'subs coming on for the home side',
  'the substitutes will help them',
  'the midfield has been so quiet',
  'can someone explain the new handball rule?',
  'it is only a foul if the contact was deliberate',
  'that rule makes no sense to me',
  'corner to the away side',
  'big chance for the home side here',
  'saved! what a stop',
  'the rebound goes wide',
  'ten minutes to half time',
  'both teams look tired',
  'the pitch looks heavy',
  'passing has been sloppy this half',
  'good press from the front line',
  'manager is going crazy on the touchline',
  'yellow card for the number 6',
  'that was never a booking',
  'free kick in a dangerous spot',
  'wall is set, here we go',
  'over the bar, not even close',
  'half time, I need a snack',
  'anyone got a prediction for the second half?',
  'I say 2-1 to the home side',
  'away side wins it late, calling it',
  'they have changed shape at the break',
  'the new striker looks sharp',
  'what a run down the wing!',
  'cross comes in... cleared',
  'the commentator keeps getting names wrong',
  'my gran is shouting at the TV again',
  'a quiet five minutes, finally',
  'throw in for the away side',
  'long ball, keeper comes out and claims it',
  'there is a sub getting ready already',
  'three minutes of added time',
  'last chance for the home side',
  'the ref blows, that is full time',
  'what a game, thanks for the company',
  'same time next week?',
  'good chat everyone',
  'night all',
]

const FLAGGED = [
  { senderId: 'sim-b', body: 'call me on 097 123 4567 and I will explain it' },
  { senderId: 'sim-d', body: 'full highlights here www.example.com/clip' },
  { senderId: 'sim-e', body: 'shut up, nobody asked, the ref was right' },
]

// Every batch gets its own number. After "Clear simulated" the position counter starts again at 0, and the
// reader check remembers its verdict by message id, so reused ids made a new message inherit an old one's
// verdict. A fresh batch number keeps every simulated message's id unique for the whole session.
let batch = 0

function build(bodies: { senderId: string; body: string }[], nowMs: number, startIndex: number): MessageView[] {
  // Spread over the last few seconds so order is clear and nothing is in the future.
  const gap = 250
  const b = ++batch
  return bodies.map((m, i) => ({
    id: `sim-${b}-${startIndex + i}`,
    senderId: m.senderId,
    body: m.body,
    sentAtMs: nowMs - (bodies.length - 1 - i) * gap,
    pending: false,
    simulated: true,
  }))
}

/** n chatty messages from five made-up people. Wraps around the list if n is large. */
export function simulatedChatter(n: number, nowMs: number, startIndex: number): MessageView[] {
  const bodies = Array.from({ length: n }, (_, i) => ({
    senderId: SIM_IDS[(startIndex + i) % SIM_IDS.length],
    body: CHATTER[(startIndex + i) % CHATTER.length],
  }))
  return build(bodies, nowMs, startIndex)
}

/** One message with a phone number, one with a link, one the AI should flag. */
export function simulatedFlagged(nowMs: number, startIndex: number): MessageView[] {
  return build(FLAGGED, nowMs, startIndex)
}

const SPOILERS = [
  { senderId: 'sim-a', body: 'GOOOAL!! 1-0 to the home side' },
  { senderId: 'sim-c', body: 'penalty awarded, and a yellow card too' },
]

/** Two messages that give away what just happened, to show the Delay Shield. */
export function simulatedSpoilers(nowMs: number, startIndex: number): MessageView[] {
  return build(SPOILERS, nowMs, startIndex)
}
