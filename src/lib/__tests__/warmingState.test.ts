import { describe, expect, it } from 'vitest'
import { isWarming, setWarming, subscribeWarming } from '../warmingState'

describe('warmingState', () => {
  it('tells listeners only when the flag really changes', () => {
    let calls = 0
    const off = subscribeWarming(() => calls++)
    setWarming(true)
    setWarming(true)
    expect(isWarming()).toBe(true)
    setWarming(false)
    expect(calls).toBe(2)
    off()
    setWarming(true)
    expect(calls).toBe(2)
    setWarming(false)
  })
})
