import { stmt, type Data } from '../domain/model'

/** Preserve dated business arithmetic without patient, clinician, clinical content or payment credentials. */
export function preserveAccounting(db:D1Database,clientId:string,anonymousGroup:string) {
  return [
    stmt(db,`INSERT INTO bm_destroyed_retail(id,kind,units,amount_cents,tax_cents,gift_id,recorded_at)
      SELECT id,kind,units,amount_cents,tax_cents,gift_id,recorded_at FROM bm_retail_sales WHERE client_id=?`,clientId),
    stmt(db,`INSERT INTO bm_destroyed_invoices(id,anonymous_group,amount_cents,start_at,open_payer)
      SELECT i.id,?,i.amount_cents,a.start_at,
        (SELECT h.payer FROM bm_invoice_insurance_hold h WHERE h.invoice_id=i.id)
      FROM bm_invoices i JOIN bm_appointments a ON a.id=i.appointment_id WHERE i.client_id=? AND i.status='approved'`,anonymousGroup,clientId),
    stmt(db,`INSERT INTO bm_destroyed_payments(id,invoice_id,amount_cents,recorded_at,kind,card_payment_id,remittance_id,account_entry_id)
      SELECT p.id,p.invoice_id,p.amount_cents,p.recorded_at,CASE WHEN p.account_entry_id IS NOT NULL THEN 'desk' WHEN p.reference LIKE 'era:%' OR p.reference LIKE 'payer:%' THEN 'insurance' WHEN p.card_payment_id IS NOT NULL THEN 'card' ELSE 'desk' END,
        p.card_payment_id,(SELECT m.id FROM bm_insurance_imports m WHERE m.kind='835' AND substr(p.reference,1,length('era:'||m.payer_id||':'||m.trace||':'))='era:'||m.payer_id||':'||m.trace||':' LIMIT 1),p.account_entry_id
      FROM bm_invoice_payments p JOIN bm_invoices i ON i.id=p.invoice_id WHERE i.client_id=?`,clientId),
    stmt(db,`INSERT INTO bm_destroyed_adjustments(id,invoice_id,amount_cents,recorded_at)
      SELECT a.id,a.invoice_id,a.amount_cents,a.recorded_at FROM bm_invoice_adjustments a JOIN bm_invoices i ON i.id=a.invoice_id WHERE i.client_id=?`,clientId),
    stmt(db,`INSERT INTO bm_destroyed_cards(id,amount_cents,applied_cents,succeeded_at,refunded_cents)
      SELECT id,amount_cents,applied_cents,succeeded_at,refunded_cents FROM bm_card_payments WHERE client_id=? AND status='succeeded'`,clientId),
    stmt(db,`INSERT INTO bm_destroyed_account_entries(id,credit_id,kind,amount_cents,posted_at)
      SELECT id,credit_id,kind,amount_cents,posted_at FROM bm_posted_account_entries
      WHERE client_id=? AND kind IN ('credit','refund')`,clientId),
    stmt(db,`INSERT INTO bm_destroyed_card_refunds(id,payment_id,amount_cents,allocated_cents,confirmed_at) SELECT r.id,r.payment_id,r.amount_cents,COALESCE((SELECT SUM(a.amount_cents) FROM bm_card_refund_allocations a WHERE a.refund_id=r.id),0),r.confirmed_at FROM bm_card_refunds r WHERE r.client_id=? AND r.status='confirmed'`,clientId),
    stmt(db,`INSERT INTO bm_destroyed_visits(id,start_at) SELECT id,start_at FROM bm_appointments WHERE client_id=? AND status='attended'`,clientId),
  ]
}
/** Anonymous report facts; remittance headers remain shared business records. */
export async function anonymousFinancialFacts(db:D1Database) {
  return (await db.batch<Data>([
    db.prepare("SELECT id,anonymous_group AS client_id,amount_cents,start_at,'Destroyed record' AS client,open_payer FROM bm_destroyed_invoices"),
    db.prepare("SELECT invoice_id,amount_cents,CASE WHEN kind='insurance' THEN 'era:' WHEN kind='card' AND amount_cents<0 THEN 'stripe-refund:' ELSE '' END AS reference,recorded_at,card_payment_id,remittance_id,account_entry_id FROM bm_destroyed_payments"),
    db.prepare("SELECT invoice_id,amount_cents,'' AS reason,recorded_at FROM bm_destroyed_adjustments"),
    db.prepare('SELECT id,amount_cents,applied_cents,succeeded_at,refunded_cents FROM bm_destroyed_cards'),
    db.prepare('SELECT start_at FROM bm_destroyed_visits'),
    db.prepare("SELECT id,credit_id,kind,amount_cents,posted_at,'' AS reference FROM bm_destroyed_account_entries"),
    db.prepare('SELECT id,payment_id,amount_cents,allocated_cents,confirmed_at FROM bm_destroyed_card_refunds'),
  ])).map(r=>r.results)
}
