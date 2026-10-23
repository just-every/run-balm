/** An already recorded copay remains collectible while the remaining payer balance is held. */
export const copayRoomSql = (invoice = '?') => `(SELECT MAX(0,c.copay_cents
 -COALESCE((SELECT SUM(p.amount_cents) FROM bm_invoice_payments p WHERE p.invoice_id=ci.id AND substr(p.reference,1,4)<>'era:' AND substr(p.reference,1,6)<>'payer:'),0)
 -COALESCE((SELECT SUM(p.amount_cents-p.applied_cents) FROM bm_card_payments p WHERE p.appointment_id=ci.appointment_id AND p.kind='copay' AND p.status='succeeded'),0))
 FROM bm_invoices ci JOIN bm_clients c ON c.id=ci.client_id WHERE ci.id=${invoice})`
