import {codingGuard} from '../codesets'
import { guard, type Data } from '../domain/model'
import { incurredClaimWhere } from './medicare'
import type { ClaimSnapshot } from './types'

/** Clinical and insurance facts used by an export are checked again inside
 * its commit, including codes which have no independent row version. */
export function claimFactGuards(db:D1Database,claim:Data,s:ClaimSnapshot) {
  const b=s.basis!
  return [
    ...(s.coding?[codingGuard(db,s.coding)]:[]),
    ...(s.cob?s.cob.prior.map(p=>guard(db,"EXISTS(SELECT 1 FROM bm_cob_stages s JOIN bm_cob_adjudications a ON a.invoice_id=s.invoice_id AND a.policy_id=s.policy_id WHERE s.invoice_id=? AND s.policy_id=? AND s.state='adjudicated' AND a.source_id=?)",s.invoiceId,p.policyId,p.sourceId)):[]),
    ...(b.assistantSupervisionCount!==undefined?[guard(db,'(SELECT COUNT(*) FROM bm_assistant_supervision s JOIN bm_notes n ON n.id=s.note_id WHERE n.appointment_id=?)=?',claim.appointment_id,b.assistantSupervisionCount)]:[]),
    ...(b.renderingStaffId ? [guard(db,'EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND version=? AND active=1 AND erased_at IS NULL)',b.renderingStaffId,b.renderingStaffVersion)] : []),
    ...(s.payer.medicare?[
      b.medicareVersion===null?guard(db,'NOT EXISTS(SELECT 1 FROM bm_medicare_years WHERE client_id=? AND year=? AND therapy_group=?)',claim.client_id,s.kx.year,s.kx.group):guard(db,'EXISTS(SELECT 1 FROM bm_medicare_years WHERE client_id=? AND year=? AND therapy_group=? AND version=?)',claim.client_id,s.kx.year,s.kx.group,b.medicareVersion),
      b.medicareSettingsVersion===null?guard(db,'NOT EXISTS(SELECT 1 FROM bm_medicare_settings WHERE year=? AND therapy_group=?)',s.kx.year,s.kx.group):guard(db,'EXISTS(SELECT 1 FROM bm_medicare_settings WHERE year=? AND therapy_group=? AND version=?)',s.kx.year,s.kx.group,b.medicareSettingsVersion),
      guard(db,`(SELECT COALESCE(SUM(c.version),0) FROM bm_claims c JOIN bm_policies p ON p.id=c.policy_id JOIN bm_payers y ON y.id=p.payer_id WHERE ${incurredClaimWhere})=?`,claim.client_id,s.kx.group,String(s.kx.year),claim.appointment_id,b.priorClaimsVersion),
      guard(db,`(SELECT COALESCE(SUM(e.version),0) FROM bm_claims c JOIN bm_policies p ON p.id=c.policy_id JOIN bm_payers y ON y.id=p.payer_id JOIN bm_medicare_expenses e ON e.claim_id=c.id WHERE ${incurredClaimWhere})=?`,claim.client_id,s.kx.group,String(s.kx.year),claim.appointment_id,b.expensesVersion)
    ]:[]),
    guard(db,'EXISTS(SELECT 1 FROM bm_policies WHERE id=? AND version=?)',claim.policy_id,b.policyVersion),
    guard(db,'EXISTS(SELECT 1 FROM bm_payers WHERE id=? AND version=?)',s.payer.id,b.payerVersion),
    guard(db,'EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND version=?)',claim.appointment_id,b.appointmentVersion),
    guard(db,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND erased_at IS NULL)',claim.client_id,b.clientVersion),
    guard(db,'EXISTS(SELECT 1 FROM bm_staff p JOIN bm_appointments a ON a.practitioner_id=p.id WHERE a.id=? AND p.version=? AND p.erased_at IS NULL)',claim.appointment_id,b.staffVersion),
    b.billingVersion===null?guard(db,'NOT EXISTS(SELECT 1 FROM bm_insurance_settings WHERE id=1)'):guard(db,'EXISTS(SELECT 1 FROM bm_insurance_settings WHERE id=1 AND version=?)',b.billingVersion),
    guard(db,"EXISTS(SELECT 1 FROM bm_invoices WHERE id=? AND amount_cents=? AND status='approved')",s.invoiceId,s.invoiceCents),
    guard(db,'(SELECT json_group_array(json_array(kind,position,code,modifiers,units)) FROM (SELECT kind,position,code,modifiers,units FROM bm_visit_codes WHERE appointment_id=? ORDER BY kind,position))=?',claim.appointment_id,b.codes),
    guard(db,'(SELECT json_group_array(json_array(id,signed_sha256)) FROM (SELECT id,signed_sha256 FROM bm_notes WHERE appointment_id=? AND signed_at IS NOT NULL ORDER BY id))=?',claim.appointment_id,b.signed)
  ]
}
