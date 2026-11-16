import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

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

/** Unauthenticated Firestore client */
export async function unauthDb() {
  const env = await getEnv()
  return env.unauthenticatedContext().firestore()
}

/** Bypass Security Rules — use only for seeding test data */
export async function adminDb() {
  const env = await getEnv()
  let db!: ReturnType<RulesTestEnvironment['unauthenticatedContext']>['firestore']
  await env.withSecurityRulesDisabled(ctx => {
    db = ctx.firestore()
    return Promise.resolve()
  })
  return db
}
