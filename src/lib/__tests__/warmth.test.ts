import { describe, expect, it } from 'vitest'
import { COLD_AFTER_MS, COLD_TIMEOUT_MS, WARM_TIMEOUT_MS, isCold, onDeviceTimeout } from '../warmth'

describe('on-device warmth', () => {
  it('is cold before any call has finished on this page', () => {
    expect(isCold(null, 1_000_000)).toBe(true)
    expect(onDeviceTimeout(null, 1_000_000)).toBe(COLD_TIMEOUT_MS)
  })

  it('is warm shortly after a call, so the short limit applies', () => {
    const t = 1_000_000
    expect(isCold(t - 5_000, t)).toBe(false)
    expect(onDeviceTimeout(t - 5_000, t)).toBe(WARM_TIMEOUT_MS)
  })

  it('goes cold again after a quiet spell, so the long limit comes back', () => {
    const t = 1_000_000
    expect(isCold(t - (COLD_AFTER_MS + 1_000), t)).toBe(true)
    expect(onDeviceTimeout(t - (COLD_AFTER_MS + 1_000), t)).toBe(COLD_TIMEOUT_MS)
    // control: just inside the window is still warm
    expect(isCold(t - (COLD_AFTER_MS - 1_000), t)).toBe(false)
  })
})
