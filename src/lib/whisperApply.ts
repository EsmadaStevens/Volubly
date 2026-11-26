import { doc, serverTimestamp, writeBatch, type Firestore } from 'firebase/firestore'
import { isServerTime, type Plan, type PlanValue } from './whisperPlans'
import { runGuarded, type WriteResult } from './whisperWrite'

/*
 * This file must not import ./firebase. The database is passed in, so the emulator test can call
 * the very same code with a rules-test Firestore. Do not rebuild a plan into a batch anywhere else.
 */

function toFirestoreValue(v: PlanValue): unknown {
  if (isServerTime(v)) return serverTimestamp()
  if (Array.isArray(v)) return v.map(toFirestoreValue)
  return v
}

function toData(data: Record<string, PlanValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toFirestoreValue(v)]))
}

/** Turns a plan into one write batch and commits it. Rejects with the Firestore error if the rules refuse. */
export async function applyPlan(db: Firestore, plan: Plan): Promise<void> {
  const batch = writeBatch(db)
  for (const op of plan) {
    const [first, ...rest] = op.path
    const ref = doc(db, first, ...rest)
    if (op.kind === 'delete') batch.delete(ref)
    else if (op.kind === 'update') batch.update(ref, toData(op.data))
    else batch.set(ref, toData(op.data))
  }
  await batch.commit()
}

/** applyPlan behind the offline check and the 10 second limit. Never rejects. */
export function commitPlan(db: Firestore, plan: Plan, opts?: { online?: boolean; timeoutMs?: number }): Promise<WriteResult> {
  return runGuarded(() => applyPlan(db, plan), opts)
}
