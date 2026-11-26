import { describe, expect, it } from 'vitest'
import { isSimId, SIM_PROFILES, simulatedChatter, simulatedFlagged } from '../demoData'
import { hiddenReason } from '../messageGuard'

const now = 1_000_000

describe('demoData', () => {
  it('every simulated message is labelled simulated, from a made-up person', () => {
    for (const m of [...simulatedChatter(60, now, 0), ...simulatedFlagged(now, 60)]) {
      expect(m.simulated).toBe(true)
      expect(isSimId(m.senderId)).toBe(true)
      expect(SIM_PROFILES[m.senderId].username.startsWith('Sim_')).toBe(true)
    }
  })
  it('ids are unique across batches and never look like real message ids', () => {
    const a = simulatedChatter(10, now, 0)
    const b = simulatedFlagged(now, a.length)
    const ids = [...a, ...b].map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith('sim-'))).toBe(true)
  })
  it('timestamps are in order and never in the future', () => {
    const msgs = simulatedChatter(60, now, 0)
    for (let i = 1; i < msgs.length; i++) expect(msgs[i].sentAtMs).toBeGreaterThan(msgs[i - 1].sentAtMs)
    expect(msgs[msgs.length - 1].sentAtMs).toBeLessThanOrEqual(now)
  })
  it('the flagged examples include a number and a link that the code hides', () => {
    const [num, link] = simulatedFlagged(now, 0)
    expect(hiddenReason(num.body, null)?.text).toContain('phone number')
    expect(hiddenReason(link.body, null)?.text).toContain('link')
  })
  it('ordinary simulated chatter is not hidden by the code checks', () => {
    for (const m of simulatedChatter(60, now, 0)) expect(hiddenReason(m.body, null)).toBeNull()
  })

  it('never reuses an id, even after the list is cleared and starts again from 0', () => {
    const first = simulatedChatter(10, now, 0).map((m) => m.id)
    const second = simulatedFlagged(now, 0).map((m) => m.id) // same start position, as after "Clear simulated"
    expect(second.some((id) => first.includes(id))).toBe(false)
  })
})
