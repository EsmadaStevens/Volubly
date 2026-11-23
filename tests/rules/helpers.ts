import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { initializeApp, deleteApp } from 'firebase/app'
import type { FirebaseApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'

export { assertFails, assertSucceeds }

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

let _env: RulesTestEnvironment | undefined

export async function getEnv(): Promise<RulesTestEnvironment> {
  if (_env) return _env
  _env = await initializeTestEnvironment({
    projectId: 'volubly-test',
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
  return _env
}

export async function teardown(): Promise<void> {
  if (_adminApp) await deleteApp(_adminApp)
  _adminApp = undefined
  _adminFs = undefined
  await _env?.cleanup()
  _env = undefined
}

export async function clearData(): Promise<void> {
  const env = await getEnv()
  await env.clearFirestore()
}

/** Firestore client authenticated as userA (uid: 'userA', ageBandLabel: '18_plus') */
export async function userADb() {
  const env = await getEnv()
  return env.authenticatedContext('userA', { ageBandLabel: '18_plus' }).firestore()
}

/** Firestore client authenticated as userB (uid: 'userB', ageBandLabel: '18_plus') */
export async function userBDb() {
  const env = await getEnv()
  return env.authenticatedContext('userB', { ageBandLabel: '18_plus' }).firestore()
}

/** Firestore client authenticated as any uid. The age band the rules use comes from the seeded users document. */
export async function userDb(uid: string) {
  const env = await getEnv()
  return env.authenticatedContext(uid).firestore()
}

/** Unauthenticated Firestore client */
export async function unauthDb() {
  const env = await getEnv()
  return env.unauthenticatedContext().firestore()
}

let _adminApp: FirebaseApp | undefined
let _adminFs: Firestore | undefined

/**
 * Bypass Security Rules - use only for seeding and reading back test data.
 * env.withSecurityRulesDisabled() disposes its context (and terminates the client)
 * as soon as its callback returns, so a handle returned from it is unusable.
 * The emulator accepts the literal token "owner" as a rules bypass, so build a
 * long-lived client with that token instead.
 */
export async function adminDb(): Promise<Firestore> {
  await getEnv()
  if (_adminFs) return _adminFs
  _adminApp = initializeApp({ projectId: 'volubly-test' }, 'volubly-admin')
  _adminFs = getFirestore(_adminApp)
  connectFirestoreEmulator(_adminFs, '127.0.0.1', 8080, { mockUserToken: 'owner' })
  return _adminFs
}