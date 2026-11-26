import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ProfileSheet from '../ProfileSheet'
import { BACKGROUNDS } from '../../lib/background'

const noop = async () => {}
const profile = { username: 'Human_1', avatarSeed: 'seed-0' }
const options = ['seed-0', 'seed-1', 'seed-2', 'seed-3', 'seed-4', 'seed-5', 'seed-6', 'seed-7']

describe('ProfileSheet', () => {
  const html = renderToStaticMarkup(<ProfileSheet profile={profile} onSave={noop} onClose={() => {}} options={options} />)

  it('shows the current username and a Save button', () => {
    expect(html).toContain('value="Human_1"')
    expect(html).toContain('Save')
    expect(html).toContain('role="dialog"')
  })

  it('offers eight avatars to pick from, with the current one selected', () => {
    for (let i = 1; i <= 8; i++) expect(html).toContain(`aria-label="Avatar option ${i}"`)
    const first = html.slice(html.indexOf('aria-label="Avatar option 1"') - 120, html.indexOf('aria-label="Avatar option 1"'))
    expect(first).toContain('aria-pressed="true"')
  })

  it('offers every background and says only you see it', () => {
    for (const b of BACKGROUNDS) expect(html).toContain(b.label)
    expect(html).toContain('Only you see this')
  })

  it('says what other people see, and when', () => {
    expect(html).toContain('next time they open the room')
  })
})
