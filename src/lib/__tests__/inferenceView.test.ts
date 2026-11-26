import { beforeEach, describe, expect, it } from 'vitest'
import { getInferenceSnapshot, recordInference, resetInferenceLog, type InferenceEvent } from '../inferenceLog'
import { describeEvent, durationText, resultText, statsText, whenText } from '../inferenceView'

const ev = (over: Partial<InferenceEvent> = {}): InferenceEvent => ({
  at: 1000,
  purpose: 'send_check',
  trigger: 'send_click',
  route: 'on_device',
  path: 'on_device',
  ms: 420,
  reason: 'On-device model was ready.',
  outcome: { kind: 'verdict', verdict: 'harassment' },
  ...over,
})

describe('describeEvent', () => {
  it('describes a sender check', () => {
    expect(describeEvent(ev(), 1500)).toEqual({
      route: 'On-device',
      purpose: 'Ghost-Mode',
      when: 'Just now',
      duration: '420 ms',
      context: 'Sender check · Draft message',
      result: 'Harassment flagged',
      why: 'On-device model was ready.',
      notChecked: false,
    })
  })
  it('describes a reader check', () => {
    const v = describeEvent(ev({ purpose: 'read_check', trigger: 'incoming_message', ms: 310, outcome: { kind: 'verdict', verdict: 'personal_address' } }), 1000 + 20_000)
    expect(v).toMatchObject({
      purpose: 'Reader protection',
      when: 'A moment ago',
      duration: '310 ms',
      context: 'Incoming message · Local device check',
      result: 'Personal address flagged',
    })
  })
  it('says skipped when nothing ran, and never calls a timeout a pass', () => {
    const v = describeEvent(ev({ route: 'skipped', path: 'none', ms: null, outcome: { kind: 'unavailable' } }), 2000)
    expect(v.route).toBe('Skipped')
    expect(v.duration).toBeNull()
    expect(v.notChecked).toBe(true)
    expect(resultText({ kind: 'timeout' })).toContain('Not checked')
    expect(resultText({ kind: 'busy' })).toContain('Not checked')
  })
  it('does not claim a path the SDK did not report', () => {
    expect(describeEvent(ev({ path: 'unknown', route: 'cloud' }), 1000).route).toBe('Cloud')
  })
  it('nothing flagged reads plainly', () => {
    expect(resultText({ kind: 'verdict', verdict: 'ok' })).toBe('Nothing flagged')
  })
})

describe('formatting', () => {
  it('times', () => {
    expect(whenText(0, 3000)).toBe('Just now')
    expect(whenText(0, 30_000)).toBe('A moment ago')
    expect(whenText(0, 180_000)).toBe('3 min ago')
    expect(durationText(1400)).toBe('1.4 s')
    expect(durationText(null)).toBeNull()
  })
})

describe('session counts are kept apart by purpose', () => {
  beforeEach(() => resetInferenceLog())

  it('sender and reader checks are counted separately, and not-checked is not a pass', () => {
    recordInference(ev())
    recordInference(ev({ outcome: { kind: 'verdict', verdict: 'ok' }, ms: 600 }))
    recordInference(ev({ purpose: 'read_check', trigger: 'incoming_message', outcome: { kind: 'verdict', verdict: 'ok' }, ms: 200 }))
    recordInference(ev({ purpose: 'read_check', trigger: 'incoming_message', path: 'none', ms: 6000, outcome: { kind: 'timeout' } }))
    recordInference(ev({ purpose: 'read_check', trigger: 'incoming_message', route: 'skipped', path: 'none', ms: null, outcome: { kind: 'busy' } }))
    const { stats } = getInferenceSnapshot()
    expect(stats.send_check).toMatchObject({ onDevice: 2, cloud: 0, notChecked: 0, flagged: 1, msOnDevice: 1020 })
    expect(stats.read_check).toMatchObject({ onDevice: 1, notChecked: 2, timedOut: 1, flagged: 0 })
    expect(stats.catch_up).toMatchObject({ onDevice: 0, cloud: 0, notChecked: 0 })
  })

  it('counts keep growing past the 20 events the list remembers', () => {
    for (let i = 0; i < 30; i++) recordInference(ev({ outcome: { kind: 'verdict', verdict: 'ok' } }))
    const snap = getInferenceSnapshot()
    expect(snap.events).toHaveLength(20)
    expect(snap.stats.send_check.onDevice).toBe(30)
  })

  it('reads out plainly', () => {
    recordInference(ev({ outcome: { kind: 'verdict', verdict: 'ok' }, ms: 1000 }))
    recordInference(ev({ path: 'none', ms: 6000, outcome: { kind: 'timeout' } }))
    const text = statsText(getInferenceSnapshot().stats.send_check)
    expect(text).toContain('1 completed (1 on-device, 0 cloud)')
    expect(text).toContain('1 not checked (1 timed out)')
    expect(text).toContain('avg on-device 1.0 s')
  })
})
