import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReviewPanel from '../ReviewPanel'

const noop = () => {}

describe('ReviewPanel', () => {
  it('offers redact, edit and send anyway when something sensitive was found', () => {
    const html = renderToStaticMarkup(
      <ReviewPanel review={{ redactedText: 'call [number hidden]', findingKinds: ['phone'], verdict: null }} onRedactSend={noop} onSendAnyway={noop} onEdit={noop} />,
    )
    expect(html).toContain('a phone number')
    expect(html).toContain('call [number hidden]')
    expect(html).toContain('Redact &amp; send')
    expect(html).toContain('Send anyway')
  })
  it('has no redact button for a model flag alone, and uses code-written words', () => {
    const html = renderToStaticMarkup(
      <ReviewPanel review={{ redactedText: null, findingKinds: [], verdict: 'threat' }} onRedactSend={noop} onSendAnyway={noop} onEdit={noop} />,
    )
    expect(html).not.toContain('Redact')
    expect(html).toContain('might come across as a threat')
    expect(html).toContain('Edit')
  })
})
