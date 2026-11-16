import { describe, it, afterAll } from 'vitest'
import { collection, getDocs } from 'firebase/firestore'
import { unauthDb, teardown, assertFails } from './helpers.js'

describe('smoke — unauthenticated access', () => {
  afterAll(teardown)

  it('denies an unauthenticated read of the rooms collection', async () => {
    const db = await unauthDb()
    await assertFails(getDocs(collection(db, 'rooms')))
  })
})
