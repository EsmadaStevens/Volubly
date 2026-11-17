import { collection, limit, orderBy, query, Timestamp, where, type Firestore, type QueryConstraint } from 'firebase/firestore'
import type { DiscoveryPlan } from './discoveryUtils'

export function buildDiscoveryQuery(db: Firestore, plan: DiscoveryPlan) {
  const constraints: QueryConstraint[] = [where('openedAt', '>', Timestamp.fromMillis(plan.openedAfterMs))]
  if (plan.maturityIn) constraints.push(where('maturityLabel', 'in', plan.maturityIn))
  constraints.push(orderBy('openedAt', plan.direction), limit(plan.limit))
  return query(collection(db, 'rooms'), ...constraints)
}
