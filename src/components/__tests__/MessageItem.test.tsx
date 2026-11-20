import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MessageItem from '../MessageItem'

const msg = { id: 'm', senderId: 's', body: 'hello <b>there</b> www.x.com', sentAtMs: 0, pending: false }

describe('MessageItem', () => {
  it('shows the name and escapes the text, without making links clickable', () => {
    const html = renderToStaticMarkup(<MessageItem message={msg} profile={{ username: 'Zed', avatarSeed: 'a' }} mine={false} />)
    expect(html).toContain('Zed')
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<a ')
  })
  it('labels your own messages "You" and puts them on the right', () => {
    const html = renderToStaticMarkup(<MessageItem message={msg} profile={{ username: 'Zed', avatarSeed: 'a' }} mine />)
    expect(html).toContain('You')
    expect(html).toContain('flex-row-reverse')
  })
  it('marks messages that are still sending', () => {
    const html = renderToStaticMarkup(<MessageItem message={{ ...msg, pending: true }} profile={null} mine={false} />)
    expect(html).toContain('sending')
    expect(html).toContain('Unknown')
  })

  it('starts hidden with a reason and a show button, and does not print the text', () => {
    const html = renderToStaticMarkup(
      <MessageItem message={msg} profile={{ username: 'Zed', avatarSeed: 'a' }} mine={false} hiddenReason="this might be a threat" />,
    )
    expect(html).toContain('Hidden: this might be a threat')
    expect(html).toContain('Show message')
    expect(html).not.toContain('hello')
  })
  it('shows the text again once revealed, with a way to hide it again', () => {
    const html = renderToStaticMarkup(
      <MessageItem message={msg} profile={null} mine={false} hiddenReason="x" revealed />,
    )
    expect(html).toContain('hello')
    expect(html).toContain('Hide again')
  })

  it('says it may be wrong for guesses, but not for plain links', () => {
    const guess = renderToStaticMarkup(<MessageItem message={msg} profile={null} mine={false} hiddenReason="this might be a threat" />)
    expect(guess).toContain('may be wrong')
    const link = renderToStaticMarkup(<MessageItem message={msg} profile={null} mine={false} hiddenReason="this message has a link" uncertain={false} />)
    expect(link).toContain('Hidden: this message has a link.')
    expect(link).not.toContain('may be wrong')
  })

  it('labels simulated messages', () => {
    const html = renderToStaticMarkup(<MessageItem message={{ ...msg, simulated: true }} profile={null} mine={false} />)
    expect(html).toContain('SIMULATED')
    expect(renderToStaticMarkup(<MessageItem message={msg} profile={null} mine={false} />)).not.toContain('SIMULATED')
  })

  it('holds a spoiler back with a countdown and a Show now button, without printing the text', () => {
    const html = renderToStaticMarkup(<MessageItem message={msg} profile={null} mine={false} heldSecs={42.2} />)
    expect(html).toContain('Held back')
    expect(html).toContain('43 s')
    expect(html).toContain('Show now')
    expect(html).not.toContain('hello')
  })
  it('shows the text once nothing is held', () => {
    expect(renderToStaticMarkup(<MessageItem message={msg} profile={null} mine={false} heldSecs={0} />)).toContain('hello')
  })
})
