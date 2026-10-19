import { stmt, type Data } from '../domain/model'

/** Preserve dated business arithmetic without patient, clinician, clinical content or payment credentials. */
export function preserveAccounting(db:D1Database,clientId:string,anonymousGroup:string) {
  return [
    stmt(db,`INSERT INTO bm_destroyed_invoices(id,anonymous_group,amount_cents,start_at,open_payer)
      SELECT i.id,?,i.amount_cents,a.start_at,
        (SELECT y.name FROM bm_claims q JOIN bm_policies p ON p.id=q.policy_id JOIN bm_payers y ON y.id=p.payer_id
         WHERE q.invoice_id=i.id AND q.status NOT IN ('corrected','paid','partial') ORDER BY q.created_at DESC LIMIT 1)
      FROM bm_invoices i JOIN bm_appointments a ON a.id=i.appointment_id WHERE i.client_id=? AND i.status='approved'`,anonymousGroup,clientId),
    stmt(db,`INSERT INTO bm_destroyed_payments(id,invoice_id,amount_cents,recorded_at,kind,card_payment_id,remittance_id)
      SELECT p.id,p.invoice_id,p.amount_cents,p.recorded_at,CASE WHEN p.reference LIKE 'era:%' THEN 'insurance' WHEN p.card_payment_id IS NOT NULL THEN 'card' ELSE 'desk' END,
        p.card_payment_id,(SELECT m.id FROM bm_insurance_imports m WHERE m.kind='835' AND substr(p.reference,1,length('era:'||m.payer_id||':'||m.trace||':'))='era:'||m.payer_id||':'||m.trace||':' LIMIT 1)
      FROM bm_payments p JOIN bm_invoices i ON i.id=p.invoice_id WHERE i.client_id=?`,clientId),
    stmt(db,`INSERT INTO bm_destroyed_adjustments(id,invoice_id,amount_cents,recorded_at)
      SELECT a.id,a.invoice_id,a.amount_cents,a.recorded_at FROM bm_insurance_adjustments a JOIN bm_invoices i ON i.id=a.invoice_id WHERE i.client_id=?`,clientId),
    stmt(db,`INSERT INTO bm_destroyed_cards(id,amount_cents,applied_cents,succeeded_at)
      SELECT id,amount_cents,applied_cents,succeeded_at FROM bm_card_payments WHERE client_id=? AND status='succeeded'`,clientId),
    stmt(db,`INSERT INTO bm_destroyed_visits(id,start_at) SELECT id,start_at FROM bm_appointments WHERE client_id=? AND status='attended'`,clientId),
  ]
}
/** Same six datasets used by REPORT-002; remittance headers remain shared business records. */
export async function anonymousFinancialFacts(db:D1Database) {
  return (await db.batch<Data>([
    db.prepare("SELECT id,anonymous_group AS client_id,amount_cents,start_at,'Destroyed record' AS client,open_payer FROM bm_destroyed_invoices"),
    db.prepare("SELECT invoice_id,amount_cents,CASE WHEN kind='insurance' THEN 'era:' ELSE '' END AS reference,recorded_at,card_payment_id,remittance_id FROM bm_destroyed_payments"),
    db.prepare("SELECT invoice_id,amount_cents,'' AS reason,recorded_at FROM bm_destroyed_adjustments"),
    db.prepare('SELECT id,amount_cents,applied_cents,succeeded_at FROM bm_destroyed_cards'),
    db.prepare('SELECT start_at FROM bm_destroyed_visits'),
  ])).map(r=>r.results)
}
