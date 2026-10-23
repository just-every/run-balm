import {claimFor} from './access'
import {scrubClaim} from './scrub'
import {audit,commit,day,guard,id,insist,integer,now,one,rows,sha256,stmt,text,type Actor,type Data} from '../domain/model'
import {insuranceActor,clientGuard} from './access'
import {readCsv} from '../movein/formats/reader'
import {cents} from './x12'
import type {RemitClaim} from './remittance-parser'

const headings=['Source claim','Patient ID','Payer ID','Patient control','Payer control','Service date','Billed','Balance','Status']
const owner=(who:Actor)=>insist(who.role==='owner','runout_owner_required',403)
const openGuard=(db:D1Database)=>guard(db,'NOT EXISTS(SELECT 1 FROM bm_runout_closures WHERE reopened_at IS NULL)')
export async function runoutCommand(db:D1Database,initial:Actor,name:string,input:Data){
 const who=await insuranceActor(db,initial,true);owner(who)
 if(name==='insurance.runout.read')return runoutState(db,who)
 if(name==='insurance.runout.reopen'){
  insist(input.attest===true||input.attest==='on','confirm_runout_reopen')
  await commit(db,who,[stmt(db,'UPDATE bm_runout_closures SET reopened_at=?,reopened_by=? WHERE reopened_at IS NULL',now(),who.email),guard(db,'changes()=1'),audit(db,who,'insurance.runout_reopened',null)])
  return {closed:false}
 }
 if(name==='insurance.runout.correct'){
  const legacy=await one(db,'SELECT * FROM bm_migrated_claims WHERE id=?',text(input.id,'migrated_claim',100))
  insist(legacy&&!legacy.native_claim_id&&['denied','rejected'].includes(legacy.status),'legacy_claim_not_awaiting_correction',409)
  insist(legacy.payer_control,'original_payer_control_required')
  insist(input.attest===true||input.attest==='on','confirm_original_signed_charge_records')
  const claim=await claimFor(db,who,input.claimId),facts=JSON.parse(claim.snapshot)
  insist(claim.status==='ready'&&claim.client_id===legacy.client_id&&claim.service_date===legacy.service_date&&facts.payer.id===legacy.payer_id&&claim.amount_cents===legacy.billed_cents,'complete_same_patient_payer_service_and_original_billed_charges',409)
  const activity=await one(db,'SELECT (SELECT COUNT(*) FROM bm_invoice_payments WHERE invoice_id=?)+(SELECT COUNT(*) FROM bm_invoice_adjustments WHERE invoice_id=?) AS n',claim.invoice_id,claim.invoice_id)
  insist(activity?.n===0,'correction_invoice_already_has_postings',409)
  facts.frequency='7';facts.originalControl=legacy.payer_control
  const errors=scrubClaim(facts);insist(!errors.length,'complete_and_scrub_original_charge_records_before_correction',409)
  insist(!await one(db,'SELECT 1 FROM bm_migrated_claims m JOIN bm_claims c ON c.id=m.native_claim_id WHERE c.invoice_id=?',claim.invoice_id),'invoice_already_carries_a_legacy_receivable',409)
  const opening=legacy.billed_cents-legacy.balance_cents
  await commit(db,who,[openGuard(db),clientGuard(db,who,legacy.client_id),
   guard(db,'NOT EXISTS(SELECT 1 FROM bm_migrated_claims m JOIN bm_claims c ON c.id=m.native_claim_id WHERE c.invoice_id=?)',claim.invoice_id),
   guard(db,'NOT EXISTS(SELECT 1 FROM bm_invoice_payments WHERE invoice_id=?) AND NOT EXISTS(SELECT 1 FROM bm_invoice_adjustments WHERE invoice_id=?)',claim.invoice_id,claim.invoice_id),
   stmt(db,"UPDATE bm_claims SET snapshot=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status='ready'",JSON.stringify(facts),now(),claim.id,claim.version),guard(db,'changes()=1'),
   ...(opening?[stmt(db,'INSERT INTO bm_runout_opening_credits(id,migrated_id,invoice_id,amount_cents,recorded_by,recorded_at) VALUES(?,?,?,?,?,?)',id(),legacy.id,claim.invoice_id,opening,who.email,now())]:[]),
   stmt(db,"UPDATE bm_migrated_claims SET native_claim_id=?,transferred_cents=balance_cents,balance_cents=0,status='transferred',version=version+1 WHERE id=? AND version=? AND native_claim_id IS NULL",claim.id,legacy.id,legacy.version),guard(db,'changes()=1'),audit(db,who,'insurance.migrated_claim_corrected',legacy.client_id,legacy.id)])
  return {id:legacy.id,claimId:claim.id,frequency:'7',originalControl:legacy.payer_control,transferredCents:legacy.balance_cents}
 }
 if(name==='insurance.runout.resolve'){
  const q=await one(db,'SELECT * FROM bm_remittance_suspense WHERE id=? AND resolved_claim IS NULL',text(input.id,'suspense',100))
  insist(q,'unmatched_remittance_not_open',409)
  const claim=await one(db,'SELECT * FROM bm_migrated_claims WHERE id=? AND payer_id=?',text(input.claimId,'migrated_claim',100),q.payer_id)
  insist(claim,'migrated_claim_not_found',404)
  const r=JSON.parse(q.detail) as RemitClaim,posting=runoutPosting(db,who,claim,r,q.import_id,q.paper_batch_id)
  insist(input.attest===true||input.attest==='on','confirm_matching_original_remittance')
  await commit(db,who,[openGuard(db),...posting.statements,stmt(db,'UPDATE bm_remittance_suspense SET resolved_claim=? WHERE id=? AND resolved_claim IS NULL',claim.id,q.id),guard(db,'changes()=1'),audit(db,who,'insurance.runout_suspense_resolved',claim.client_id,q.id)])
  return {id:q.id,claimId:claim.id,resolved:true}
 }
 if(name==='insurance.runout.close'){
  insist(input.attest===true||input.attest==='on','confirm_runout_close')
  await commit(db,who,[openGuard(db),guard(db,`NOT EXISTS(SELECT 1 FROM bm_migrated_claims WHERE balance_cents<>0) AND NOT EXISTS(SELECT 1 FROM bm_remittance_suspense WHERE resolved_claim IS NULL) AND NOT EXISTS(SELECT 1 FROM bm_migrated_claims m JOIN bm_claims c ON c.id=m.native_claim_id JOIN bm_invoices i ON i.id=c.invoice_id WHERE i.amount_cents>(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_payments WHERE invoice_id=i.id)+(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_adjustments WHERE invoice_id=i.id))`),stmt(db,'INSERT INTO bm_runout_closures(id,closed_by,closed_at) VALUES(?,?,?)',id(),who.email,now()),audit(db,who,'insurance.runout_closed',null)])
  return {closed:true}
 }
 insist(['insurance.runout.preview','insurance.runout.apply'].includes(name),'unknown_runout_command',404)
 const source=text(input.source,'source_system',100),csv=text(input.csv,'AR_csv',500_000),parsed=readCsv(csv)
 insist(JSON.stringify(parsed[0]?.cells)===JSON.stringify(headings),'runout_csv_headers_do_not_match_guide')
 const records:Data[]=[],seen=new Set<string>()
 for(const row of parsed.slice(1).filter(r=>r.cells.some(c=>c.trim()))){
  insist(row.cells.length===headings.length,'runout_csv_column_count')
  const [sourceClaim,clientId,payerId,patientControl,payerControl,date,billed,balance,status]=row.cells.map(c=>c.trim())
  text(sourceClaim,'source_claim',100);text(patientControl,'patient_control',100);insist(!seen.has(sourceClaim),'duplicate_source_claim');seen.add(sourceClaim)
  text(payerControl||'not yet assigned','payer_control',100)
  insist(['open','denied','rejected'].includes(status),'invalid_migrated_claim_status')
  const billedCents=cents(billed,'billed'),balanceCents=cents(balance,'balance');insist(billedCents>0&&balanceCents<=billedCents,'invalid_migrated_claim_amounts')
  insist(await one(db,'SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL',clientId),'runout_patient_not_found',404)
  insist(await one(db,'SELECT 1 FROM bm_payers WHERE id=?',payerId),'runout_payer_not_found',404)
  insist(!await one(db,'SELECT 1 FROM bm_claims WHERE id=?',patientControl),'patient_control_belongs_to_Balm_claim',409)
  const existing=await one(db,'SELECT * FROM bm_migrated_claims WHERE source=? AND source_claim=?',source,sourceClaim)
  const record={sourceClaim,clientId,payerId,patientControl,payerControl,serviceDate:day(date,'service_date'),billedCents,balanceCents,status}
  const sourceHash=await sha256(JSON.stringify(record))
  if(existing)insist(existing.source_hash===sourceHash&&existing.client_id===clientId&&existing.payer_id===payerId&&existing.patient_control===patientControl&&existing.payer_control===payerControl&&existing.service_date===date&&existing.billed_cents===billedCents&&existing.initial_cents===balanceCents,'source_claim_changed_review_original',409)
  records.push({...record,sourceHash,id:existing?.id??id(),existing:!!existing})
 }
 insist(records.length>0&&records.length<=100,'runout_requires_1_to_100_claims')
 const balanceCents=records.reduce((sum,r)=>sum+r.balanceCents,0),fingerprint=await sha256(JSON.stringify([source,csv]))
 if(name.endsWith('.preview')){await commit(db,who,[audit(db,who,'insurance.runout_previewed',null)]);return {fingerprint,balanceCents,count:records.length,records}}
 insist(text(input.fingerprint,'fingerprint',64)===fingerprint,'runout_preview_changed',409)
 insist(integer(input.expectedBalanceCents,'source_AR_total')===balanceCents,'source_AR_total_does_not_reconcile',409)
 const fresh=records.filter(r=>!r.existing),at=now()
 await commit(db,who,[openGuard(db),...fresh.flatMap(r=>[clientGuard(db,who,r.clientId),guard(db,'NOT EXISTS(SELECT 1 FROM bm_claims WHERE id=?)',r.patientControl),stmt(db,`INSERT INTO bm_migrated_claims(id,source,source_claim,client_id,payer_id,source_hash,patient_control,payer_control,service_date,billed_cents,initial_cents,balance_cents,status,imported_by,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,r.id,source,r.sourceClaim,r.clientId,r.payerId,r.sourceHash,r.patientControl,r.payerControl,r.serviceDate,r.billedCents,r.balanceCents,r.balanceCents,r.status,who.email,at),audit(db,who,'insurance.migrated_claim_imported',r.clientId,r.id)])])
 return {count:records.length,imported:fresh.length,balanceCents,claims:records.map(r=>r.id)}
}

/** Only an unambiguous payer-scoped identity can post automatically. */
export async function matchMigrated(db:D1Database,payerId:string,r:RemitClaim){
 let matches=await rows(db,'SELECT * FROM bm_migrated_claims WHERE payer_id=? AND (patient_control=? OR (?<>\'\' AND payer_control=?))',payerId,r.id,r.control,r.control)
 if(!matches.length&&r.patient&&r.serviceDate)matches=await rows(db,`SELECT m.* FROM bm_migrated_claims m JOIN bm_clients c ON c.id=m.client_id WHERE m.payer_id=? AND lower(c.first_name)=lower(?) AND lower(c.last_name)=lower(?) AND m.service_date=? AND m.billed_cents=? AND c.erased_at IS NULL`,payerId,r.patient.first,r.patient.last,r.serviceDate,r.chargeCents)
 return matches.length===1?matches[0]:null
}
export function runoutPosting(db:D1Database,who:Actor,claim:Data,r:RemitClaim,importId:string|null,paperBatchId:string|null=null){
 insist(r.chargeCents===claim.billed_cents,'migrated_remittance_charge_mismatch',409)
 const co=r.status==='4'?0:r.adjustments.filter(a=>a.group==='CO'&&['45','253'].includes(a.reason)).reduce((sum,a)=>sum+a.amountCents,0)
 insist(!r.adjustments.some(a=>a.group==='OA'||a.group==='PI'),'migrated_adjustment_group_requires_review')
 const reduction=r.paidCents+co;insist(reduction<=claim.balance_cents,'migrated_remittance_would_overpost',409)
 const status=r.status==='4'?'denied':claim.balance_cents===reduction?'paid':'partial',at=now()
 return {outcome:{id:claim.id,migrated:true,status,paidCents:r.paidCents,adjustmentCents:co,patientResponsibilityCents:r.prCents},statements:[
  clientGuard(db,who,claim.client_id),openGuard(db),stmt(db,'UPDATE bm_migrated_claims SET balance_cents=balance_cents-?,status=?,version=version+1 WHERE id=? AND version=? AND balance_cents>=?',reduction,status,claim.id,claim.version,reduction),guard(db,'changes()=1'),
  stmt(db,'INSERT INTO bm_runout_postings(id,import_id,paper_batch_id,migrated_id,paid_cents,adjustment_cents,pr_cents,detail,created_at) VALUES(?,?,?,?,?,?,?,?,?)',id(),importId,paperBatchId,claim.id,r.paidCents,co,r.prCents,JSON.stringify(r),at),audit(db,who,'insurance.migrated_remittance_posted',claim.client_id,claim.id)]}
}
export async function runoutState(db:D1Database,who:Actor){
 if(who.role!=='owner')return null
 const claims=await rows(db,`SELECT m.*,p.name AS payer,c.first_name||' '||c.last_name AS patient,CAST(julianday(date('now'))-julianday(m.service_date) AS INTEGER) AS age_days FROM bm_migrated_claims m JOIN bm_payers p ON p.id=m.payer_id JOIN bm_clients c ON c.id=m.client_id WHERE c.erased_at IS NULL ORDER BY m.payer_id,m.service_date,m.id`)
 for(const c of claims)if(c.native_claim_id){
  const carried=await one(db,`SELECT MAX(0,i.amount_cents-(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_payments WHERE invoice_id=i.id)-(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_adjustments WHERE invoice_id=i.id)) AS cents FROM bm_claims c JOIN bm_invoices i ON i.id=c.invoice_id WHERE c.id=?`,c.native_claim_id)
  c.balance_cents=carried?.cents??c.transferred_cents
 }
 const suspense=await rows(db,`SELECT q.id,q.import_id,q.patient_control,q.paid_cents,q.reason,p.name AS payer,q.payer_id FROM bm_remittance_suspense q JOIN bm_payers p ON p.id=q.payer_id WHERE q.resolved_claim IS NULL ORDER BY q.created_at,q.id`)
 const totals=claims.reduce((t,r)=>{t.importedCents+=r.initial_cents;t.remainingCents+=r.balance_cents;const bucket=r.age_days<=30?'0-30':r.age_days<=60?'31-60':r.age_days<=90?'61-90':'91+';const key=r.payer+' / '+bucket;t.byPayerAge[key]=(t.byPayerAge[key]??0)+r.balance_cents;return t},{importedCents:0,remainingCents:0,byPayerAge:{} as Record<string,number>})
 const posted=await one(db,'SELECT COALESCE(SUM(paid_cents),0) AS paidCents,COALESCE(SUM(adjustment_cents),0) AS adjustmentCents FROM bm_runout_postings')
 const carried=await one(db,`SELECT COALESCE(SUM((SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_payments WHERE invoice_id=c.invoice_id)),0) AS paid,COALESCE(SUM((SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_adjustments WHERE invoice_id=c.invoice_id AND reason<>'Incumbent amount settled before cutover')),0) AS adjusted FROM bm_migrated_claims m JOIN bm_claims c ON c.id=m.native_claim_id`)
 posted!.paidCents+=carried!.paid;posted!.adjustmentCents+=carried!.adjusted
 const deposits=await rows(db,`SELECT i.id,i.trace,i.amount_cents AS depositCents,d.native_cents AS nativeCents,(SELECT COALESCE(SUM(paid_cents),0) FROM bm_runout_postings WHERE import_id=i.id) AS migratedCents,(SELECT COALESCE(SUM(paid_cents),0) FROM bm_remittance_suspense WHERE import_id=i.id AND resolved_claim IS NULL) AS suspenseCents FROM bm_insurance_imports i JOIN bm_runout_deposits d ON d.import_id=i.id WHERE i.kind='835' ORDER BY i.imported_at DESC LIMIT 100`)
 await commit(db,who,[...claims.flatMap(c=>[clientGuard(db,who,c.client_id),audit(db,who,'insurance.runout_read',c.client_id,c.id)]),audit(db,who,'insurance.suspense_read',null)])
 return {claims,suspense,totals,posted,deposits,closed:!!await one(db,'SELECT 1 FROM bm_runout_closures WHERE reopened_at IS NULL')}
}
