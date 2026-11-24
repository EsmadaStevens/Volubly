import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LoadingScreen from '../LoadingScreen'

describe('LoadingScreen', () => {
  it('names the app, says what is happening, and announces itself politely', () => {
    const html = renderToStaticMarkup(<LoadingScreen />)
    expect(html).toContain('Volubly')
    expect(html).toContain('Waking up the chat')
    expect(html).toContain('role="status"')
  })
  it('only animates for people who have not asked for less motion', () => {
    const html = renderToStaticMarkup(<LoadingScreen />)
    expect(html).toContain('motion-safe:animate-bounce')
    expect(html).not.toMatch(/(^|\s)animate-bounce/)
  })
})
