import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * A source check for two rules that are about how the hooks are written, not what they return:
 * - every document read uses data({ serverTimestamps: 'estimate' }), so a write that has not reached
 *   the server still has usable times;
 * - every listener goes through useSubscription, which is the only place one is closed.
 */
const FILES = ['useWhispers.ts', 'useWhisper.ts', 'useWhisperMessages.ts']
const read = (name: string) => readFileSync(resolve(process.cwd(), 'src/hooks', name), 'utf8')

describe('whisper data hooks (source)', () => {
  it.each(FILES)('%s reads every document with serverTimestamps: estimate', (file) => {
    const src = read(file)
    const calls = src.match(/\.data\(/g) ?? []
    expect(calls.length).toBeGreaterThan(0)
    const withEstimate = src.match(/\.data\(\{ serverTimestamps: 'estimate' \}\)/g) ?? []
    expect(withEstimate.length).toBe(calls.length)
  })

  it.each(FILES)('%s opens its listener only through useSubscription', (file) => {
    const src = read(file)
    expect(src).toMatch(/useSubscription\(/)
    expect(src).not.toMatch(/\buseEffect\b/)
    // The unsubscribe function is returned to useSubscription, never dropped.
    expect(src).toMatch(/\(emit\) =>\s*[\s\S]*onSnapshot\(/)
  })

  it('no whisper hook or whisper page calls onSnapshot outside the hooks folder', () => {
    for (const file of ['src/pages/WhispersPage.tsx', 'src/pages/WhisperPage.tsx', 'src/components/PersonSheet.tsx']) {
      let src = ''
      try {
        src = readFileSync(resolve(process.cwd(), file), 'utf8')
      } catch {
        continue // the screen does not exist yet
      }
      expect(src).not.toMatch(/onSnapshot/)
    }
  })
})
