import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TryItBody } from '../TryItCard'

describe('TryItBody', () => {
  it('gives three steps, names the phone route, and offers a way to dismiss', () => {
    const html = renderToStaticMarkup(<TryItBody onDismiss={() => {}} />)
    expect(html).toContain('Try Ghost-Mode in 30 seconds')
    expect(html).toContain('nobody asked')
    expect(html).toContain('Got it')
    expect(html).toContain('cloud check')
  })
  it('has no dismiss button when none is given', () => {
    expect(renderToStaticMarkup(<TryItBody />)).not.toContain('Got it')
  })
})
