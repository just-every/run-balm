import { rows, stmt } from '../domain/model'
import type { Inventory } from './inventory'

const imported = ['bm_clients','bm_appointments','bm_movein_notes','bm_movein_balances','bm_movein_insurance']
export async function sharedCopies(db: D1Database, found: Inventory, clientId: string) {
  const terms = imported.map(t=>`(r.target_table='${t}' AND r.target_id IN (SELECT id FROM ${t} WHERE rowid IN (SELECT value FROM json_each(?))))`)
  const matches = await rows(db,`SELECT r.rowid rid,r.job_id FROM bm_movein_records r WHERE ${terms.join(' OR ')}`, ...imported.map(t=>JSON.stringify(found[t]??[])))
  const batches = await rows(db,'SELECT DISTINCT batch_id FROM bm_claim_batch_items WHERE claim_id IN (SELECT id FROM bm_claims WHERE client_id=?)',clientId)
  const manualBatches=await rows(db,'SELECT batch_id FROM bm_payer_payment_lines WHERE client_id=? UNION SELECT batch_id FROM bm_runout_paper_lines WHERE client_id=? UNION SELECT q.paper_batch_id AS batch_id FROM bm_remittance_suspense q JOIN bm_migrated_claims m ON m.id=q.resolved_claim WHERE m.client_id=? AND q.paper_batch_id IS NOT NULL',clientId,clientId,clientId)
  return {payerBatches:manualBatches.map(b=>b.batch_id), moveinRecords: matches.map(r=>r.rid), moveinJobs:[...new Set(matches.map(r=>r.job_id))], claimBatches:batches.map(r=>r.batch_id) }
}
/** Shared raw originals are withdrawn in full; other patients' native records remain. */
export function purgeCopies(db: D1Database, clientId: string, copies: Awaited<ReturnType<typeof sharedCopies>>) {
  return [
    stmt(db,'DELETE FROM bm_payer_eobs WHERE batch_id IN (SELECT value FROM json_each(?))',JSON.stringify(copies.payerBatches)),
    stmt(db,`DELETE FROM rer_mail_event_states WHERE EXISTS(SELECT 1 FROM bm_mail_attempts a WHERE a.client_id=?
      AND a.provider=rer_mail_event_states.provider AND a.tenant_id=rer_mail_event_states.tenant_id AND a.event_namespace=rer_mail_event_states.event_namespace
      AND a.recipient=rer_mail_event_states.recipient AND (a.provider_message_id=rer_mail_event_states.provider_message_id
        OR EXISTS(SELECT 1 FROM rer_mail_event_receipts r WHERE r.provider=rer_mail_event_states.provider AND r.tenant_id=rer_mail_event_states.tenant_id
          AND r.event_namespace=rer_mail_event_states.event_namespace AND r.event_id=rer_mail_event_states.event_id AND json_extract(r.event_json,'$.deliveryId')=a.id)))`,clientId),
    stmt(db,`DELETE FROM rer_mail_event_receipts WHERE EXISTS(SELECT 1 FROM bm_mail_attempts a WHERE a.client_id=?
      AND a.provider=rer_mail_event_receipts.provider AND a.tenant_id=rer_mail_event_receipts.tenant_id AND a.event_namespace=rer_mail_event_receipts.event_namespace
      AND (json_extract(event_json,'$.providerMessageId')=a.provider_message_id OR json_extract(event_json,'$.deliveryId')=a.id))`,clientId),
    stmt(db,`DELETE FROM bm_draft_requests WHERE json_extract(result,'$.id') IN (SELECT id FROM bm_notes WHERE client_id=?)`,clientId),
    stmt(db,`DELETE FROM bm_approvals WHERE subject_id IN (SELECT id FROM bm_invoices WHERE client_id=? UNION SELECT id FROM bm_drafts WHERE client_id=?)`,clientId,clientId),
    stmt(db,`UPDATE bm_claim_batches SET body='',sha256='',reference=NULL,version=version+1 WHERE id IN (SELECT value FROM json_each(?))`,JSON.stringify(copies.claimBatches)),
    stmt(db,`UPDATE bm_movein_jobs SET source_json='{"withdrawn":"retention_destruction"}',report_json='{"withdrawn":"retention_destruction"}',acceptance_reason='' WHERE id IN (SELECT value FROM json_each(?))`,JSON.stringify(copies.moveinJobs)),
    stmt(db,'DELETE FROM bm_movein_payloads WHERE job_id IN (SELECT value FROM json_each(?))',JSON.stringify(copies.moveinJobs)),
    stmt(db,'DELETE FROM bm_movein_records WHERE rowid IN (SELECT value FROM json_each(?))',JSON.stringify(copies.moveinRecords)),
  ]
}
