// The selected visit's patient as the day view's side panel shows it: coverage
// (policy, authorization, eligibility), the claim a payer denied with its dated
// trail, and the patient's case for the case agent strip. Statuses and dates
// only: no note text or intake answers reach this panel.
import type { Bindings } from '../auth.server'
import { caseForClient } from './cases'
import { insuranceFile } from './insurance'
import { one, type Actor, type Data } from './domain/model'

const FIX = ['denied', 'rejected', 'partial']

/** What happened to a claim, oldest first: the visit's note signed, the 837P built or sent, and the payer's answer. */
async function claimTrail(db: D1Database, claim: Data) {
  const [note, batch, era] = await Promise.all([
    one(db, 'SELECT MIN(signed_at) AS at FROM bm_notes WHERE appointment_id=? AND signed_at IS NOT NULL', claim.appointment_id),
    one(db, 'SELECT b.created_at,b.status FROM bm_claim_batches b JOIN bm_claim_batch_items i ON i.batch_id=b.id WHERE i.claim_id=?', claim.id),
    one(db, 'SELECT i.imported_at FROM bm_remittance_claims r JOIN bm_insurance_imports i ON i.id=r.import_id WHERE r.claim_id=?', claim.id),
  ])
  const sent: Record<string, string> = { prepared: '837P built', exported: '837P exported for the clearinghouse', sending: '837P sending', submitted: '837P sent through the clearinghouse', uncertain: '837P sent; outcome unknown' }
  return [
    ...(note?.at ? [{ at: note.at as string, text: 'Visit note signed' }] : []),
    ...(batch ? [{ at: batch.created_at as string, text: sent[batch.status as string] ?? '837P built' }] : []),
    { at: (era?.imported_at ?? claim.updated_at) as string, text: claim.status === 'rejected' ? 'Rejected by the payer' : claim.status === 'partial' ? 'Partly denied' : 'Denied', fault: true },
  ]
}

export async function visitSummary(env: Bindings, who: Actor, clientId: string) {
  if (who.role === 'agent') return null
  const desk = who.role === 'owner' || who.staffRole === 'reception'
  const insurance = await insuranceFile(env.DB, who, clientId)
  const fix = insurance.claims.find((c: Data) => FIX.includes(c.status))
  return { insurance, denied: fix ? { claim: fix, trail: await claimTrail(env.DB, fix) } : null, case: desk ? await caseForClient(env, who, clientId) : null }
}
