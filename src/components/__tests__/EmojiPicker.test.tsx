import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import EmojiPicker from '../EmojiPicker'
import { EMOJI_GROUPS } from '../../lib/emoji'

const noop = () => {}

describe('EmojiPicker', () => {
  it('shows only the button until it is opened', () => {
    const html = renderToStaticMarkup(<EmojiPicker onPick={noop} />)
    expect(html).toContain('Add an emoji')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('role="dialog"')
  })

  it('when open, shows the groups and the first group as buttons', () => {
    const html = renderToStaticMarkup(<EmojiPicker onPick={noop} defaultOpen />)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-expanded="true"')
    // static markup writes "&" as "&amp;"
    for (const g of EMOJI_GROUPS) expect(html).toContain(`aria-label="${g.label.replace('&', '&amp;')}"`)
    for (const e of EMOJI_GROUPS[0].emoji) expect(html).toContain(`aria-label="${e}"`)
    // the other groups' emoji are not drawn until their tab is chosen
    expect(html).not.toContain(`aria-label="${EMOJI_GROUPS[2].emoji[0]}"`)
  })

  it('can be disabled while a message is being checked or sent', () => {
    const html = renderToStaticMarkup(<EmojiPicker onPick={noop} disabled />)
    expect(html).toContain('disabled')
  })
})
