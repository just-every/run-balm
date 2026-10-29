import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'

// Read envelope controls independently of Balm's parser.
export async function functionalAckFile(original,rejected=false) {
 const segments=original.trim().split('~').filter(Boolean).map(s=>s.trim().split('*'))
 const isa=segments[0],gs=segments.find(s=>s[0]==='GS'),st=segments.find(s=>s[0]==='ST')
 let file=await readFile(new URL('./fixtures/insurance/999-'+(rejected?'rejected':'accepted')+'.x12',import.meta.url),'utf8')
 file=file.replace('AETNA          ',isa[8]).replace('BALMTEST       ',isa[6]).replace('GS*FA*AETNA*BALMTEST*','GS*FA*'+gs[3]+'*'+gs[2]+'*').replaceAll('{{GROUP}}',gs[6]).replaceAll('{{TRANSACTION}}',st[2]).replaceAll('{{GUIDE}}',gs[8])
 const ack=file.trim().split('~').filter(Boolean).map(s=>s.split('*'))
 assert.equal(ack[0][13],ack.at(-1)[2]);assert.equal(ack[1][6],ack.at(-2)[2])
 assert.equal(ack[3][2],gs[6]);assert.equal(ack[4][2],st[2]);assert.equal(Number(ack.at(-3)[1]),ack.length-4)
 return file
}

// Historical clinic fixture for reviewed destruction; patient and accounting
// records already exist. The live import journey covers native claim creation.
export async function historicalFunctionalReceipt(h,{clientId,policyId,appointmentId,invoiceId}) {
 const claimId=crypto.randomUUID(),batchId=crypto.randomUUID(),id=crypto.randomUUID()
 const original='ISA*00*          *00*          *ZZ*BALMTEST       *ZZ*AETNA          *900102*1200*^*00501*000000001*0*T*:~GS*HC*BALMTEST*AETNA*19900102*1200*1*X*005010X222A1~ST*837*0001*005010X222A1~SE*2*0001~GE*1*1~IEA*1*000000001~'
 const body=await functionalAckFile(original,true)
 const {createHash}=await import('node:crypto'),hash=value=>createHash('sha256').update(value).digest('hex')
 await h.db.prepare("INSERT INTO bm_claims(id,client_id,appointment_id,policy_id,invoice_id,snapshot,status,amount_cents,therapy_group,service_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'{}','paid',9500,'pt_slp','1990-01-02',?,'1990-01-02T00:00:00Z','1990-01-02T00:00:00Z')").bind(claimId,clientId,appointmentId,policyId,invoiceId,h.auth.OWNER_EMAIL).run()
 await h.db.prepare("INSERT INTO bm_claim_batches(id,payer_id,body,sha256,status,created_by,created_at) SELECT ?,payer_id,?,?,'exported',?,'1990-01-02T00:00:00Z' FROM bm_policies WHERE id=?").bind(batchId,original,hash(original),h.auth.OWNER_EMAIL,policyId).run()
 await h.db.prepare('INSERT INTO bm_claim_batch_items VALUES(?,?)').bind(batchId,claimId).run()
 await h.db.prepare("INSERT INTO bm_functional_acknowledgments(id,batch_id,body,sha256,interchange_control,group_control,transaction_control,syntax_status,reasons,imported_by,imported_at) VALUES(?,?,?,?,'000000901','901','0001','rejected','[]',?,'1990-01-02T00:00:00Z')").bind(id,batchId,body,hash(body),h.auth.OWNER_EMAIL).run()
 return {id,batchId,body,original}
}
