import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import MessageItem from '../MessageItem'
import type { MessageView } from '../../types'

// The existing MessageItem.test.tsx is not edited. This file covers the new optional name button only.
const msg: MessageView = { id: 'm1', senderId: 'p', body: 'hello', sentAtMs: 1_800_000_000_000, pending: false }
const profile = { username: 'sam_22', avatarSeed: 'seed' }

describe('MessageItem name button', () => {
  it('renders the name as plain text when no handler is given (as before)', () => {
    const html = renderToStaticMarkup(<MessageItem message={msg} profile={profile} mine={false} />)
    expect(html).toContain('sam_22')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('aria-label="Open')
  })

  it('renders a button with an accessible name and a 44px tap area when a handler is given', () => {
    const html = renderToStaticMarkup(<MessageItem message={msg} profile={profile} mine={false} onNameClick={vi.fn()} />)
    expect(html).toContain('<button')
    expect(html).toContain('aria-label="Open sam_22"')
    expect(html).toContain('after:-inset-y-[14px]') // 16px line + 2 x 14px = 44px
    expect(html).toContain('sam_22')
  })

  it("never makes the reader's own name a button", () => {
    const html = renderToStaticMarkup(<MessageItem message={msg} profile={profile} mine={true} onNameClick={vi.fn()} />)
    expect(html).not.toContain('<button')
    expect(html).toContain('You')
  })

  it('does not make the name a button until the profile has loaded, or when there is none', () => {
    expect(renderToStaticMarkup(<MessageItem message={msg} profile={undefined} mine={false} onNameClick={vi.fn()} />)).not.toContain('<button')
    expect(renderToStaticMarkup(<MessageItem message={msg} profile={null} mine={false} onNameClick={vi.fn()} />)).not.toContain('<button')
  })
})
