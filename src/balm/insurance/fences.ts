import { guard, type Data } from '../domain/model'
import type { ClaimSnapshot } from './types'

/** Clinical and insurance facts used by an export are checked again inside
 * its commit, including codes which have no independent row version. */
export function claimFactGuards(db:D1Database,claim:Data,s:ClaimSnapshot) {
  const b=s.basis!
  return [
    ...(s.payer.medicare?[
      b.medicareVersion===null?guard(db,'NOT EXISTS(SELECT 1 FROM bm_medicare_years WHERE client_id=? AND year=? AND therapy_group=?)',claim.client_id,s.kx.year,s.kx.group):guard(db,'EXISTS(SELECT 1 FROM bm_medicare_years WHERE client_id=? AND year=? AND therapy_group=? AND version=?)',claim.client_id,s.kx.year,s.kx.group,b.medicareVersion),
      guard(db,`(SELECT COALESCE(SUM(c.version),0) FROM bm_claims c JOIN bm_policies p ON p.id=c.policy_id JOIN bm_payers y ON y.id=p.payer_id WHERE c.client_id=? AND y.medicare=1 AND c.therapy_group=? AND substr(c.service_date,1,4)=? AND c.appointment_id<>? AND c.status IN ('batched','exported','submitted','accepted','paid','partial','denied'))=?`,claim.client_id,s.kx.group,String(s.kx.year),claim.appointment_id,b.priorClaimsVersion)
    ]:[]),
    guard(db,'EXISTS(SELECT 1 FROM bm_policies WHERE id=? AND version=?)',claim.policy_id,b.policyVersion),
    guard(db,'EXISTS(SELECT 1 FROM bm_payers WHERE id=? AND version=?)',s.payer.id,b.payerVersion),
    guard(db,'EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND version=?)',claim.appointment_id,b.appointmentVersion),
    guard(db,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND erased_at IS NULL)',claim.client_id,b.clientVersion),
    guard(db,'EXISTS(SELECT 1 FROM bm_staff p JOIN bm_appointments a ON a.practitioner_id=p.id WHERE a.id=? AND p.version=? AND p.erased_at IS NULL)',claim.appointment_id,b.staffVersion),
    guard(db,'EXISTS(SELECT 1 FROM bm_insurance_settings WHERE id=1 AND version=?)',b.billingVersion),
    guard(db,"EXISTS(SELECT 1 FROM bm_invoices WHERE id=? AND amount_cents=? AND status='approved')",s.invoiceId,s.invoiceCents),
    guard(db,'(SELECT json_group_array(json_array(kind,position,code,modifiers,units)) FROM (SELECT kind,position,code,modifiers,units FROM bm_visit_codes WHERE appointment_id=? ORDER BY kind,position))=?',claim.appointment_id,b.codes),
    guard(db,'(SELECT json_group_array(json_array(id,signed_sha256)) FROM (SELECT id,signed_sha256 FROM bm_notes WHERE appointment_id=? AND signed_at IS NOT NULL ORDER BY id))=?',claim.appointment_id,b.signed)
  ]
}
