import type { Bindings } from '../../auth.server'
import { clientVisible } from '../domain/clients'
import { audit, commit, day, guard, human, id, insist, integer, need, now, one, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { dispatchPatientMail } from '../mail/dispatch'
import { statementPdf } from './documents'
import { ledger } from './ledger'
import { clinicDay } from './plan-balance'
import { originalBase64, statementOriginal } from './statements'
import { nativePdfBatch } from './pdf'

export async function statementCycleState(db: D1Database) {
  return { settings: await one(db, 'SELECT * FROM bm_statement_cycle_settings WHERE id=1'),
    cycles: await rows(db, `SELECT c.*,COUNT(s.id) AS patients,COALESCE(SUM(s.amount_cents),0) AS total_cents FROM bm_statement_cycles c LEFT JOIN bm_cycle_statements s ON s.cycle_id=c.id GROUP BY c.id ORDER BY c.cycle_on DESC LIMIT 24`) }
}
export async function cyclePatient(db: D1Database, clientId: string) {
  return { preference: await one(db, 'SELECT * FROM bm_statement_preferences WHERE client_id=?', clientId),
    deliveries: await rows(db, `SELECT d.*,s.cycle_id,s.amount_cents,s.due_on FROM bm_statement_deliveries d JOIN bm_cycle_statements s ON s.id=d.statement_id WHERE s.client_id=? ORDER BY d.occurred_at DESC,d.rowid DESC`, clientId) }
}

async function runCycle(env: Bindings, db: D1Database, who: Actor | null, cycleOn: string) {
  const existing = await one(db, 'SELECT id FROM bm_statement_cycles WHERE cycle_on=?', cycleOn)
  if (existing) return { id: existing.id, duplicate: true, issued: 0 }
  const actor = who ?? { email: 'payment scheduler', role: 'payments' }
  const at = now(), batchId = id(), epoch = (await one(db, 'SELECT version FROM bm_retention_epoch WHERE id=1'))!.version
  const minimum = Number((await one(db, 'SELECT minimum_cents FROM bm_statement_cycle_settings WHERE id=1'))!.minimum_cents)
  const clients = await rows(db, `SELECT p.*,c.email,c.first_name,c.last_name FROM bm_statement_preferences p JOIN bm_clients c ON c.id=p.client_id WHERE c.erased_at IS NULL AND p.hold=0 AND p.returned_at IS NULL ORDER BY c.id`)
  const candidates: Data[] = []
  for (const client of clients) {
    const balance = (await ledger(db, client.client_id)).patientBalanceCents
    if (balance <= minimum || balance <= 0) continue
    // No collection cycle while any insurer still owes an adjudication.
    if (await one(db, `SELECT 1 FROM bm_invoice_insurance_hold h JOIN bm_invoices i ON i.id=h.invoice_id WHERE i.client_id=? AND i.status='approved'`, client.client_id)) continue
    const oldest = await one(db, `SELECT MIN(i.approved_at) AS at FROM bm_invoices i WHERE i.client_id=? AND i.status='approved' AND i.amount_cents>COALESCE((SELECT SUM(amount_cents) FROM bm_invoice_payments p WHERE p.invoice_id=i.id),0)+COALESCE((SELECT SUM(amount_cents) FROM bm_invoice_adjustments a WHERE a.invoice_id=i.id),0)`, client.client_id)
    const age = Math.max(0, Math.floor((Date.parse(at) - Date.parse(oldest?.at ?? at)) / 86400000))
    const dunning = age >= 90 ? 'Your balance is at least 90 days old. Please contact the clinic to discuss payment.' : age >= 60 ? 'Your balance is at least 60 days old. Please arrange payment with the clinic.' : age >= 30 ? 'Your balance is at least 30 days old. Please review your payment options.' : 'Please review your statement and payment options.'
    const document = await statementPdf(db, client.client_id, { at, dunning, ...(client.channel === 'mail' ? { address: client.address } : {}) })
    insist(document.balanceCents === balance, 'changed_refresh_and_retry', 409)
    candidates.push({ ...client, id: id(), balance, age, dunning, original: originalBase64(document.bytes) })
  }
  await commit(db, who, [
    guard(db, 'EXISTS(SELECT 1 FROM bm_retention_epoch WHERE id=1 AND version=?)', epoch),
    stmt(db, 'INSERT INTO bm_statement_cycles(id,cycle_on,created_at,created_by) VALUES(?,?,?,?)', batchId, cycleOn, at, actor.email),
    ...candidates.flatMap(c => [stmt(db, `INSERT INTO bm_cycle_statements(id,client_id,cycle_id,due_on,amount_cents,original_base64,issued_at,channel,address,patient_name,age_days,dunning) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, c.id,c.client_id,batchId,cycleOn,c.balance,c.original,at,c.channel,c.address,`${c.first_name} ${c.last_name}`,c.age,c.dunning),
      stmt(db, 'INSERT INTO bm_statement_deliveries VALUES(?,?,?,?,?,?,?)', id(),c.id,c.channel,c.channel === 'mail' ? 'prepared' : 'reserved',at,actor.email,batchId), audit(db,actor,'patient_statement.issued',c.client_id,c.id)]),
  ])
  for (const c of candidates.filter(c => c.channel === 'email')) {
    // Exactly one attempt after durable reservation; uncertain outcomes need human review.
    const submission = await dispatchPatientMail(env,c.email,`Statement from ${(await one(db,'SELECT clinic_name FROM bm_settings WHERE id=1'))!.clinic_name}`,
      `A statement is ready. Sign in to your patient portal to open the fixed original and payment options:\n${new URL('/portal',env.AUTH_ORIGIN).href}\nStatement reference: ${c.id}`, {clientId:c.client_id,appointmentIds:[],kind:'reminder',deliveryId:c.id})
    await commit(db,null,[stmt(db,'INSERT INTO bm_statement_deliveries VALUES(?,?,?,?,?,?,?)',id(),c.id,'email',submission.state,now(),'payment mail',submission.providerMessageId ?? batchId),audit(db,actor,'patient_statement.email_outcome',c.client_id,c.id,submission.state)])
  }
  return { id:batchId, issued:candidates.length, totalCents:candidates.reduce((n,c)=>n+c.balance,0) }
}

/** Recorded preferences authorize a monthly cycle; a missed tick runs once. */
export async function scheduledStatementCycle(env: Bindings, db: D1Database, today: string) {
  if (!await one(db, 'SELECT 1 FROM bm_statement_preferences WHERE hold=0 AND returned_at IS NULL')) return
  return runCycle(env, db, null, today.slice(0,7)+'-01')
}

export async function statementCycleCommand(env: Bindings, db: D1Database, who: Actor, name: string, input: Data) {
  need(who,'owner','reception'); human(who)
  if (name === 'pay.cycle.settings') {
    need(who,'owner')
    const minimum = integer(input.minimumCents,'minimum_cents',0,10000000)
    await commit(db,who,[stmt(db,'UPDATE bm_statement_cycle_settings SET minimum_cents=? WHERE id=1',minimum),audit(db,who,'statement_cycle.settings_saved',null)])
    return {minimumCents:minimum}
  }
  if (name === 'pay.cycle.run') {
    insist(input.confirm === true || input.confirm === 'on','confirm_statement_cycle')
    const date = day(input.cycleOn,'cycle_date'), zone=(await one(db,'SELECT time_zone FROM bm_settings WHERE id=1'))!.time_zone
    insist(date<=clinicDay(now(),zone),'cycle_date_cannot_be_future')
    // A monthly cycle has one canonical identity, even if invoked on another day.
    return runCycle(env,db,who,date.slice(0,7)+'-01')
  }
  const client=await clientVisible(db,who,input.clientId), clientId=String(client.id)
  if(name==='pay.cycle.preference') {
    const channel=text(input.channel,'channel',10), address=String(input.address ?? '').trim()
    insist(['email','mail'].includes(channel),'invalid_statement_channel')
    insist(channel!=='email'||client.email,'the_patient_has_no_email_address',409)
    insist(channel!=='mail'||address.length>=10&&address.length<=300&&address.split('\n').length<=4,'enter_complete_mailing_address')
    insist(input.authorized===true||input.authorized==='on','record_the_patient_authorization_first')
    const evidence=text(input.evidence,'preference_evidence',1000),hold=input.hold===true||input.hold==='on'?1:0
    await commit(db,who,[stmt(db,`INSERT INTO bm_statement_preferences VALUES(?,?,?,?,NULL,?,?,?) ON CONFLICT(client_id) DO UPDATE SET channel=excluded.channel,address=excluded.address,hold=excluded.hold,returned_at=NULL,consent_evidence=excluded.consent_evidence,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at`,clientId,channel,address,hold,evidence,who.email,now()),audit(db,who,'statement.preference_recorded',clientId)])
    return {clientId,channel,hold}
  }
  insist(name==='pay.cycle.mailed'||name==='pay.cycle.returned','unknown_command',404)
  const statement=await one(db,"SELECT * FROM bm_cycle_statements WHERE id=? AND client_id=? AND channel='mail'",text(input.statementId,'statement',100),clientId)
  insist(statement,'statement_not_found',404)
  const on=day(input.occurredOn,'delivery_date'),reference=text(input.reference,'mail_reference',200),outcome=name==='pay.cycle.mailed'?'mailed':'returned'
  insist(on<=clinicDay(now(),(await one(db,'SELECT time_zone FROM bm_settings WHERE id=1'))!.time_zone),'delivery_date_cannot_be_future')
  await commit(db,who,[guard(db,'NOT EXISTS(SELECT 1 FROM bm_statement_deliveries WHERE statement_id=? AND outcome=?)',statement.id,outcome),stmt(db,'INSERT INTO bm_statement_deliveries VALUES(?,?,?,?,?,?,?)',id(),statement.id,'mail',outcome,on,who.email,reference),...(outcome==='returned'?[stmt(db,'UPDATE bm_statement_preferences SET returned_at=?,hold=1 WHERE client_id=?',on,clientId)]:[]),audit(db,who,'statement.'+outcome,clientId,statement.id)])
  return {outcome}
}

export async function statementBatch(db: D1Database, who: Actor, path: string) {
  const match=path.match(/^\/api\/balm\/statement-batches\/([\w-]+)\.(pdf|csv)$/)
  if(!match)return null
  need(who,'owner','reception');human(who)
  const [,batchId,format]=match
  insist(await one(db,'SELECT id FROM bm_statement_cycles WHERE id=?',batchId),'batch_not_found',404)
  const items=await rows(db,"SELECT * FROM bm_cycle_statements WHERE cycle_id=? AND channel='mail' ORDER BY patient_name,id",batchId)
  insist(items.length,'no_mailed_statements_in_batch',409)
  await commit(db,who,[...items.map(s=>audit(db,who,'statement_batch.exported',s.client_id,s.id,format))])
  const body=format==='pdf'?nativePdfBatch(await Promise.all(items.map(async s=>(await statementOriginal(db,s.client_id,s.id)).bytes))):
    [['batch','statement','patient','address','amount_cents'],...items.map(s=>[batchId,s.id,s.patient_name,s.address,s.amount_cents]),[batchId,'TOTAL','','',items.reduce((n,s)=>n+Number(s.amount_cents),0)]].map(row=>row.map(v=>'"'+String(v).replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n')
  return new Response(body,{headers:{'content-type':format==='pdf'?'application/pdf':'text/csv; charset=utf-8','content-disposition':`attachment; filename="statements-${batchId}.${format}"`,'cache-control':'no-store','x-content-type-options':'nosniff'}})
}
