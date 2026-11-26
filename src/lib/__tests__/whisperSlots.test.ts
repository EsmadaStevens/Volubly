import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { pickSlot, type SlotDoc } from '../whisperSlots'
import { INVITE_WINDOW_MS, SLOT_MARGIN_MS, SLOT_NUMBERS, THREAD_MS, WHISPER_STATUSES, type SlotNumber, type WhisperView } from '../whisperTypes'

const MIN = 60_000
const NOW = 1_800_000_000_000

function view(id: string, over: Partial<WhisperView> = {}): WhisperView {
  return {
    id,
    inviterId: 'me',
    inviteeId: 'them',
    status: 'requested',
    createdAtMs: NOW - 5 * MIN,
    acceptedAtMs: null,
    endedBy: null,
    inviterSlot: 1,
    inviteeSlot: null,
    expiresAt: { toMillis: () => NOW } as unknown as WhisperView['expiresAt'],
    ...over,
  }
}
const slot = (n: SlotNumber, whisperId: string): SlotDoc => ({ n, whisperId })
const busyPending = (id: string) => view(id) // 5 minutes old
const busyOpen = (id: string) => view(id, { status: 'accepted', createdAtMs: NOW - 31 * MIN, acceptedAtMs: NOW - 30 * MIN, inviteeSlot: 1 })

describe('pickSlot examples', () => {
  it('uses slot 1 when there are no slot documents', () => {
    expect(pickSlot([], [], NOW)).toBe(1)
  })
  it('uses a never-used slot before a free one', () => {
    const ended = view('a', { status: 'ended', endedBy: 'me' })
    expect(pickSlot([slot(1, 'a'), slot(2, 'b')], [ended, busyPending('b')], NOW)).toBe(3)
  })
  it('treats a slot whose whisper is not in the list as free (cleaned up)', () => {
    expect(pickSlot([slot(1, 'gone'), slot(2, 'b'), slot(3, 'c')], [busyPending('b'), busyOpen('c')], NOW)).toBe(1)
  })
  it('returns null when all three are busy', () => {
    const list = [busyPending('a'), busyOpen('b'), busyPending('c')]
    expect(pickSlot([slot(1, 'a'), slot(2, 'b'), slot(3, 'c')], list, NOW)).toBeNull()
  })
  it('declined and ended whispers free their slot at once', () => {
    const list = [view('a', { status: 'declined' }), busyOpen('b'), busyOpen('c')]
    expect(pickSlot([slot(1, 'a'), slot(2, 'b'), slot(3, 'c')], list, NOW)).toBe(1)
    const list2 = [busyOpen('a'), view('b', { status: 'ended', endedBy: 'them' }), busyOpen('c')]
    expect(pickSlot([slot(1, 'a'), slot(2, 'b'), slot(3, 'c')], list2, NOW)).toBe(2)
  })
  it('a stale pending invite stays busy for 60 seconds past the 15 minutes', () => {
    const insideMargin = view('a', { createdAtMs: NOW - INVITE_WINDOW_MS - SLOT_MARGIN_MS + 1000 })
    const outsideMargin = view('a', { createdAtMs: NOW - INVITE_WINDOW_MS - SLOT_MARGIN_MS - 1000 })
    const others = [busyOpen('b'), busyOpen('c')]
    const slots = [slot(1, 'a'), slot(2, 'b'), slot(3, 'c')]
    expect(pickSlot(slots, [insideMargin, ...others], NOW)).toBeNull()
    expect(pickSlot(slots, [outsideMargin, ...others], NOW)).toBe(1)
  })
  it('an accepted thread stays busy for 60 seconds past the hour', () => {
    const at = (offset: number) => view('a', { status: 'accepted', createdAtMs: NOW - 2 * THREAD_MS, acceptedAtMs: NOW - THREAD_MS - SLOT_MARGIN_MS + offset, inviteeSlot: 1 })
    const others = [busyOpen('b'), busyOpen('c')]
    const slots = [slot(1, 'a'), slot(2, 'b'), slot(3, 'c')]
    expect(pickSlot(slots, [at(1000), ...others], NOW)).toBeNull()
    expect(pickSlot(slots, [at(-1000), ...others], NOW)).toBe(1)
  })
  it('an accepted whisper with no acceptedAt is busy, the safe side', () => {
    const odd = view('a', { status: 'accepted', acceptedAtMs: null })
    expect(pickSlot([slot(1, 'a'), slot(2, 'b'), slot(3, 'c')], [odd, busyOpen('b'), busyOpen('c')], NOW)).toBeNull()
  })
  it('among free slots, the one free longest comes first; ties go to the lower number', () => {
    const older = view('a', { status: 'ended', createdAtMs: NOW - 50 * MIN })
    const newer = view('b', { status: 'ended', createdAtMs: NOW - 10 * MIN })
    const slots = [slot(1, 'b'), slot(2, 'a'), slot(3, 'c')]
    expect(pickSlot(slots, [older, newer, busyOpen('c')], NOW)).toBe(2)
    const same1 = view('x', { status: 'ended', createdAtMs: NOW - 10 * MIN })
    const same2 = view('y', { status: 'ended', createdAtMs: NOW - 10 * MIN })
    expect(pickSlot([slot(1, 'x'), slot(2, 'y'), slot(3, 'c')], [same1, same2, busyOpen('c')], NOW)).toBe(1)
  })
})

// An independent statement of "busy", written from the rules text, not copied from the implementation.
function isBusy(w: WhisperView, now: number): boolean {
  if (w.status === 'declined' || w.status === 'ended') return false
  if (w.status === 'requested') return now < w.createdAtMs + INVITE_WINDOW_MS + SLOT_MARGIN_MS
  return w.acceptedAtMs === null || now < w.acceptedAtMs + THREAD_MS + SLOT_MARGIN_MS
}

const worldArb = fc
  .record({
    // For each of the three slots: absent, names a whisper that is missing, or names a generated whisper.
    cells: fc.array(
      fc.oneof(
        fc.constant({ kind: 'none' as const }),
        fc.constant({ kind: 'gone' as const }),
        fc.record({
          kind: fc.constant('has' as const),
          status: fc.constantFrom(...WHISPER_STATUSES),
          createdAtMs: fc.integer({ min: NOW - 4 * THREAD_MS, max: NOW }),
          acceptedAtMs: fc.option(fc.integer({ min: NOW - 4 * THREAD_MS, max: NOW }), { nil: null }),
        }),
      ),
      { minLength: 3, maxLength: 3 },
    ),
  })
  .map(({ cells }) => {
    const slots: SlotDoc[] = []
    const whispers: WhisperView[] = []
    cells.forEach((c, i) => {
      const n = SLOT_NUMBERS[i]
      if (c.kind === 'none') return
      slots.push({ n, whisperId: `w${n}` })
      if (c.kind === 'has') whispers.push(view(`w${n}`, { status: c.status, createdAtMs: c.createdAtMs, acceptedAtMs: c.acceptedAtMs }))
    })
    return { slots, whispers }
  })

describe('pickSlot properties', () => {
  it('never returns a busy slot, and returns null exactly when all three are busy', () => {
    fc.assert(
      fc.property(worldArb, ({ slots, whispers }) => {
        const busyFor = (n: SlotNumber) => {
          const s = slots.find((x) => x.n === n)
          if (!s) return false
          const w = whispers.find((x) => x.id === s.whisperId)
          return w ? isBusy(w, NOW) : false
        }
        const picked = pickSlot(slots, whispers, NOW)
        const allBusy = SLOT_NUMBERS.every(busyFor)
        expect(picked === null).toBe(allBusy)
        if (picked !== null) expect(busyFor(picked)).toBe(false)
      }),
    )
  })

  it('prefers a never-used slot when there is one (the lowest such number)', () => {
    fc.assert(
      fc.property(worldArb, ({ slots, whispers }) => {
        const unused = SLOT_NUMBERS.filter((n) => !slots.some((s) => s.n === n))
        const picked = pickSlot(slots, whispers, NOW)
        if (unused.length > 0) expect(picked).toBe(unused[0])
      }),
    )
  })
})
