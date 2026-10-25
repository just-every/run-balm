import assert from 'node:assert/strict'
import {clinic} from './clinic.mjs'
export async function financeReviewJourney(h){
 await clinic(h)
 const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Finance',email:'finance@patient.example'})
 const base={clientId:patient.id,amountCents:9500,occurredOn:'2026-09-15',evidence:'Owner reviewed synthetic settlement original'}
 const eft=await h.cmd('finance.observation.record',{...base,kind:'eft',reference:'synthetic-balm-eft',sourceReference:'synthetic-balm-trace'})
 for(const reference of ['synthetic-balm-card-1','synthetic-balm-card-2'])await h.cmd('finance.observation.record',{...base,kind:'card',reference,sourceReference:'synthetic-balm-original-charge'})
 // Same amount with a different charge is legitimate and must not be flagged.
 await h.cmd('finance.observation.record',{...base,kind:'card',reference:'synthetic-balm-card-3',sourceReference:'synthetic-balm-different-charge'})
 const key=await h.cmd('agent.create',{label:'Finance review',scopes:['finance.reconcile.prepare']})
 const prepare=()=>h.send('/api/balm/agent/command',{name:'finance.reconcile.prepare',input:{month:'2026-09'}},'',{authorization:'Bearer '+key.token})
 const before=h.mail.length
 const prepared=await prepare();assert.equal(prepared.status,200,prepared.text)
 const findings=prepared.value.result.findings
 assert.equal(findings.length,2)
 assert.ok(findings.find(r=>r.kind==='missing_era').payload.citations.includes(eft.id))
 const missing=findings.find(r=>r.kind==='missing_era')
 assert.match(missing.payload.requestDraft,/synthetic-balm-trace/)
 const duplicate=findings.find(r=>r.kind==='possible_duplicate_card')
 assert.equal(duplicate.payload.refundDraft.amountCents,9500)
 assert.ok(duplicate.payload.citations.includes('synthetic-balm-card-1'))
 assert.ok(duplicate.payload.citations.includes('synthetic-balm-card-2'))
 assert.equal((await prepare()).value.result.findings.length,2)
 const wrong=await h.cmd('agent.create',{label:'Schedule only',scopes:['appointments.read']})
 assert.equal((await h.send('/api/balm/agent/command',{name:'finance.reconcile.prepare',input:{month:'2026-09'}},'',{authorization:'Bearer '+wrong.token})).status,403)
 const desk=await h.staff('FinanceDesk','reception')
 await h.cmd('finance.review.approve',{id:duplicate.id,sha256:duplicate.sha256,confirm:true},desk.cookie,403)
 await h.cmd('finance.review.approve',{id:duplicate.id,sha256:'changed',confirm:true},h.owner,409)
 const approved=await h.cmd('finance.review.approve',{id:duplicate.id,sha256:duplicate.sha256,confirm:true})
 assert.deepEqual([approved.approved,approved.outbound,approved.refunded],[true,false,false])
 await h.cmd('finance.review.approve',{id:duplicate.id,sha256:duplicate.sha256,confirm:true},h.owner,409)
 const file=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value
 assert.equal(file.billing.ledger.balanceCents,0)
 assert.equal(file.billing.payments.length,0)
 await h.cmd('client.erase',{id:patient.id},h.owner,409)
 assert.ok(file.audit.some(a=>a.action==='finance.preparation_approved'&&a.detail===duplicate.sha256))
 assert.equal(h.mail.length,before+1,'only the native staff invitation was sent')
 await h.cmd('agent.revoke',{id:key.id});assert.equal((await prepare()).status,401)
}
