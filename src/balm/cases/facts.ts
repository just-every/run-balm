// Reads every record one case is judged from. A case covers the client's visits
// from its referral's date until the client's next referral, on the referral's
// policy; nothing here writes, so the state can always be recomputed.
import { hostDateAt } from '../availability/timezone'
import { one, rows, type Data } from '../domain/model'
import { claimAuthorizations } from '../insurance/claim-authorization'
import { ledger } from '../payments/ledger'
import type { CaseFacts } from './types'

export async function caseFacts(db: D1Database, referral: Data): Promise<CaseFacts> {
  const clientId = referral.client_id as string
  const [clinic, client, policy, auths, visits, notes, invoices, claims, intake, money, statement, done, drafts, next] = await Promise.all([
    one(db, 'SELECT s.clinic_name,s.time_zone,i.billing_npi FROM bm_settings s LEFT JOIN bm_insurance_settings i ON i.id=s.id WHERE s.id=1'),
    one(db, 'SELECT id,first_name,last_name,date_of_birth,email FROM bm_clients WHERE id=? AND erased_at IS NULL', clientId),
    referral.policy_id ? one(db, 'SELECT p.*,y.name AS payer_name FROM bm_policies p JOIN bm_payers y ON y.id=p.payer_id WHERE p.id=?', referral.policy_id) : Promise.resolve(null),
    claimAuthorizations(db, clientId),
    rows(db, `SELECT a.id,a.start_at,a.status,a.practitioner_id,s.name AS service,p.name AS practitioner,p.profession FROM bm_appointments a JOIN bm_services s ON s.id=a.service_id
      JOIN bm_staff p ON p.id=a.practitioner_id WHERE a.client_id=? AND a.status IN ('booked','attended') ORDER BY a.start_at`, clientId),
    rows(db, 'SELECT id,appointment_id,template,signed_at,signer_name,signer_credentials,signed_revision FROM bm_notes WHERE client_id=? ORDER BY created_at', clientId),
    rows(db, "SELECT id,number,appointment_id,status,amount_cents FROM bm_invoices WHERE client_id=? AND status<>'void'", clientId),
    rows(db, `SELECT c.id,c.appointment_id,c.policy_id,c.status,c.errors,c.payer_control,c.service_date,c.amount_cents,c.snapshot,c.updated_at,
      r.paid_cents,r.pr_cents,r.adjustments,r.payer_control AS era_control,i.trace AS era_trace,i.imported_at AS era_at,
      (SELECT MAX(a.sequence) FROM bm_audit a WHERE a.client_id=c.client_id AND a.subject_id=c.id AND a.action='insurance.remittance_posted') AS remittance_sequence
      FROM bm_claims c LEFT JOIN bm_remittance_claims r ON r.claim_id=c.id LEFT JOIN bm_insurance_imports i ON i.id=r.import_id
      WHERE c.client_id=? AND c.status<>'corrected' ORDER BY c.service_date`, clientId),
    one(db, 'SELECT MIN(submitted_at) AS at FROM bm_intake_responses WHERE client_id=?', clientId),
    ledger(db, clientId),
    one(db, "SELECT MAX(created_at) AS at FROM bm_pay_links WHERE client_id=? AND purpose='balance' AND delivery='email' AND delivery_result='sent'", clientId),
    rows(db, 'SELECT * FROM bm_case_steps WHERE referral_id=? ORDER BY approved_at DESC', referral.id),
    rows(db, 'SELECT * FROM bm_case_drafts WHERE referral_id=?', referral.id),
    one(db, 'SELECT MIN(received_on) AS on_ FROM bm_referrals WHERE client_id=? AND received_on>? ', clientId, referral.received_on),
  ])
  for(const claim of claims){
    const latest=await one(db,"SELECT e.detail,i.trace,i.imported_at FROM bm_claim_events e JOIN bm_insurance_imports i ON i.id=(SELECT source_id FROM bm_cob_adjudications WHERE claim_id=e.claim_id ORDER BY recorded_at DESC,rowid DESC LIMIT 1) WHERE e.claim_id=? AND e.kind='835' ORDER BY e.created_at DESC,e.rowid DESC LIMIT 1",claim.id)
    if(latest){const detail=JSON.parse(latest.detail);claim.paid_cents=detail.paidCents;claim.pr_cents=detail.prCents;claim.era_trace=latest.trace;claim.era_at=latest.imported_at;claim.adjustments=JSON.stringify({adjustments:detail.adjustments,remarks:detail.remarks,lines:detail.lines})}

    const manual=await rows(db,`SELECT l.*,b.reference,b.closed_at FROM bm_payer_payment_lines l JOIN bm_payer_payment_batches b ON b.id=l.batch_id WHERE l.claim_id=? AND b.status='closed' ORDER BY b.closed_at,l.id`,claim.id)
    if(manual.length){
      claim.paid_cents=Number(claim.paid_cents??0)+manual.reduce((sum,l)=>sum+(l.kind==='recoupment'?-l.amount_cents:l.paid_cents),0)
      claim.pr_cents=Number(claim.pr_cents??0)+manual.reduce((sum,l)=>sum+l.pr_cents,0)
      const prior=claim.adjustments?JSON.parse(claim.adjustments):{adjustments:[],remarks:[]}
      claim.adjustments=JSON.stringify({adjustments:[...prior.adjustments,...manual.flatMap(l=>JSON.parse(l.adjustments))],remarks:[...prior.remarks,...manual.flatMap(l=>JSON.parse(l.remarks))]})
      claim.era_trace=manual.at(-1)!.reference;claim.era_at=manual.at(-1)!.closed_at;claim.remittance_kind='Paper EOB'
    }
  }
  const zone = clinic!.time_zone as string, until = next?.on_ as string | null
  const inCase = (iso: string) => { const d = hostDateAt(new Date(iso), zone); return d >= referral.received_on && (!until || d < until) }
  const caseVisits = visits.filter(v => inCase(v.start_at)), ids = new Set(caseVisits.map(v => v.id))
  const latest = policy ? await one(db, 'SELECT id,service_date,status,created_at,checked_at FROM bm_eligibility WHERE policy_id=? ORDER BY created_at DESC LIMIT 1', policy.id) : null
  return {
    referral, client: client!, policy, eligibility: latest, clinic: clinic!, zone, today: hostDateAt(new Date(), zone),
    authorizations: policy ? auths.filter(a => a.policy_id === policy.id) : [],
    visits: caseVisits, notes: notes.filter(n => ids.has(n.appointment_id)), invoices: invoices.filter(i => ids.has(i.appointment_id)),
    claims: claims.filter(c => ids.has(c.appointment_id) && (!policy || c.policy_id === policy.id)).map(c => ({ ...c, errors: JSON.parse(c.errors), snapshot: (()=>{const s=JSON.parse(c.snapshot);delete s.distinctServices;if(s.coding){delete s.coding.priorContext;s.coding.proposals=(s.coding.proposals??[]).map((p:Data)=>({code:p.code,modifier:p.modifier,version:p.version}))}return s})(), adjustments: c.adjustments ? JSON.parse(c.adjustments) : null })),
    intakeAt: intake?.at as string | null ?? null, balanceCents: money.patientBalanceCents, lastStatementAt: statement?.at as string | null ?? null, done, drafts,
  }
}
