import assert from 'node:assert/strict'
import {clinic} from './clinic.mjs'
export async function financeReviewJourney(h){
 await clinic(h)
 const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Finance',email:['finance','patient.example'].join(String.fromCharCode(64))})
 const base={clientId:patient.id,amountCents:9500,occurredOn:'2026-09-15',evidence:'Owner reviewed synthetic settlement original'}
 const eft=await h.cmd('finance.observation.record',{...base,kind:'eft',reference:'synthetic-balm-eft',sourceReference:'synthetic-balm-trace'})
 for(const reference of ['synthetic-balm-card-1','synthetic-balm-card-2'])await h.cmd('finance.observation.record',{...base,kind:'card',reference,sourceReference:'synthetic-balm-original-charge'})
 // Same amount with a different charge is legitimate and must not be flagged.
 await h.cmd('finance.observation.record',{...base,kind:'card',reference:'synthetic-balm-card-3',sourceReference:'synthetic-balm-different-charge'})
 const sourceBase={...base,confirm:true,sourceReference:'synthetic-balm-different-charge'}
 for(const [kind,amountCents,feeCents] of [['charge',9500,0],['payout',9200,300],['accounting',9400,0]])await h.cmd('finance.source.record',{...sourceBase,kind,amountCents,feeCents,reference:'synthetic-balm-source-'+kind})
 await h.cmd('finance.source.record',{...sourceBase,kind:'charge',reference:'synthetic-balm-unconfirmed',confirm:false},h.owner,400)
 await h.cmd('finance.source.record',{...sourceBase,kind:'charge',feeCents:1,reference:'synthetic-balm-invalid-fee'},h.owner,400)
 const foreign=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Isolated'})
 await h.cmd('finance.source.record',{...sourceBase,clientId:foreign.id,kind:'charge',reference:'synthetic-balm-foreign-source'})
 const key=await h.cmd('agent.create',{label:'Finance review',scopes:['finance.reconcile.prepare']})
 const prepare=()=>h.send('/api/balm/agent/command',{name:'finance.reconcile.prepare',input:{month:'2026-09'}},'',{authorization:'Bearer '+key.token})
 const before=h.mail.length
 const prepared=await prepare();assert.equal(prepared.status,200,prepared.text)
 const matching=prepared.value.result.matching
 assert.equal(matching.length,8,'every recorded settlement and source gets one explanation')
 assert.equal(new Set(matching.map(x=>x.id)).size,8)
 const card=matching.find(x=>x.reference==='synthetic-balm-card-3')
 assert.deepEqual(card.totals,{cardCents:9500,chargeCents:9500,payoutCents:9200,feeCents:300,accountingCents:9400})
 assert.match(card.explanations.join(' '),/accounting differs.*100 cents/)
 assert.equal(card.citations.length,4,'same reference on another patient never joins')
 assert.ok(matching.find(x=>x.reference==='synthetic-balm-card-1').explanations.some(x=>x.includes('No owner-recorded charge')))
 const isolated=matching.find(x=>x.reference==='synthetic-balm-foreign-source')
 assert.equal(isolated.citations.length,1)
 assert.ok(isolated.explanations.some(x=>x.includes('No recorded card settlement')))
 await h.cmd('finance.source.record',{...sourceBase,kind:'accounting',amountCents:100,reference:'synthetic-balm-accounting-remainder'})
 await h.cmd('finance.source.record',{...sourceBase,kind:'accounting',amountCents:9500,sourceReference:'synthetic-balm-trace',reference:'synthetic-balm-eft-accounting'})
 const eftMatching=(await prepare()).value.result.matching.filter(x=>x.sourceReference==='synthetic-balm-trace')
 assert.equal(eftMatching.length,2)
 assert.ok(eftMatching.every(x=>x.explanations.length===1&&x.explanations[0].includes('No ERA')))
 const completed=(await prepare()).value.result.matching.filter(x=>x.sourceReference==='synthetic-balm-different-charge'&&x.clientId===patient.id)
 assert.equal(completed.length,5)
 assert.ok(completed.every(x=>x.status==='recorded_amounts_agree'))
 assert.ok(completed.every(x=>x.explanations[0].includes('no provider verification')))
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
 await h.cmd('finance.source.record',{...sourceBase,kind:'charge',reference:'synthetic-balm-forbidden'},desk.cookie,403)
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
 await wholePayoutJourney(h)
}

/** Independent originals for a 35,000-cent payout across three patients. */
export async function payoutFixture(h, suffix='journey') {
 const patients=[], portions=[]
 for(const [index,gross,fee] of [[1,10000,300],[2,20000,600],[3,5000,150]]) {
  const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Payout '+index+' '+suffix,dateOfBirth:'1950-01-01'})
  patients.push(patient)
  const base={clientId:patient.id,occurredOn:'2026-09-15',evidence:'Synthetic owner original '+index,sourceReference:'synthetic-balm-'+suffix+'-charge-'+index,confirm:true}
  const settlement=await h.cmd('finance.observation.record',{...base,kind:'card',amountCents:gross,reference:'synthetic-balm-'+suffix+'-settlement-'+index})
  const source=await h.cmd('finance.source.record',{...base,kind:'payout',amountCents:gross-fee,feeCents:fee,reference:'synthetic-balm-'+suffix+'-portion-'+index})
  for(const kind of ['charge','accounting'])await h.cmd('finance.source.record',{...base,kind,amountCents:gross,reference:'synthetic-balm-'+suffix+'-'+kind+'-'+index})
  portions.push({sourceId:source.id,observationId:settlement.id,clientId:patient.id})
 }
 const record={accountReference:'synthetic-balm-account-'+suffix,payoutReference:'synthetic-balm-whole-'+suffix,grossCents:35000,feeCents:1050,netCents:33950,occurredOn:'2026-09-16',evidence:'Synthetic whole payout original',confirm:true}
 const payout=await h.cmd('finance.payout.record',record)
 const link=i=>({payoutId:payout.id,accountReference:record.accountReference,payoutReference:record.payoutReference,...portions[i],confirm:true})
 return {record,payout,link,patients,portions}
}

async function wholePayoutJourney(h) {
 const {record,payout,link,patients,portions}=await payoutFixture(h)
 assert.equal((await h.cmd('finance.payout.record',record)).id,payout.id,'same original replays without a new envelope')
 await h.cmd('finance.payout.record',{...record,evidence:'Changed original'},h.owner,409)
 await h.cmd('finance.payout.record',{...record,netCents:1},h.owner,400)
 const outbound=h.outboundRequests.length
 const firstLink=await h.cmd('finance.payout.link',link(0))
 assert.equal((await h.cmd('finance.payout.link',link(0))).id,firstLink.id)
 const prepare=()=>h.cmd('finance.reconcile.prepare',{month:'2026-09'})
 const find=result=>result.payouts.filter(r=>r.payout_id===payout.id).at(-1)
 const first=find(await prepare())
 assert.deepEqual(first.payload.totals,{grossCents:10000,feeCents:300,netCents:9700,settlementCents:10000,chargeCents:10000,accountingCents:10000,unallocatedGrossCents:25000,unallocatedFeeCents:750,unallocatedNetCents:24250})
 assert.equal(find(await prepare()).id,first.id,'unchanged sources keep one fixed comparison')
 await h.cmd('finance.payout.link',{...link(1),accountReference:'synthetic-balm-wrong-account'},h.owner,409)
 await h.cmd('finance.payout.link',{...link(1),payoutReference:'synthetic-balm-wrong-reference'},h.owner,409)
 await h.cmd('finance.payout.link',{...link(1),observationId:portions[2].observationId},h.owner,409)
 await h.cmd('finance.payout.link',link(1))
 await h.cmd('finance.payout.approve',{id:first.id,sha256:first.sha256,confirm:true},h.owner,409)
 const partial=find(await prepare())
 assert.deepEqual(partial.payload.totals,{grossCents:30000,feeCents:900,netCents:29100,settlementCents:30000,chargeCents:30000,accountingCents:30000,unallocatedGrossCents:5000,unallocatedFeeCents:150,unallocatedNetCents:4850})
 assert.match(partial.payload.explanations.join(' '),/missing portions/)
 const approve={id:partial.id,sha256:partial.sha256,confirm:true}
 await h.cmd('finance.payout.approve',{...approve,sha256:'changed'},h.owner,409)
 const approvals=await Promise.all([h.send('/api/balm/command',{name:'finance.payout.approve',input:approve},h.owner),h.send('/api/balm/command',{name:'finance.payout.approve',input:approve},h.owner)])
 assert.deepEqual(approvals.map(r=>r.status).sort(),[200,409])
 assert.deepEqual([approvals.find(r=>r.status===200).value.result.outbound,approvals.find(r=>r.status===200).value.result.refunded],[false,false])
 await h.cmd('finance.payout.link',link(2))
 const complete=find(await prepare())
 assert.deepEqual(complete.payload.totals,{grossCents:35000,feeCents:1050,netCents:33950,settlementCents:35000,chargeCents:35000,accountingCents:35000,unallocatedGrossCents:0,unallocatedFeeCents:0,unallocatedNetCents:0})
 assert.equal(complete.payload.status,'recorded_amounts_agree')
 assert.equal(complete.payload.portions.length,3)
 assert.equal(new Set(complete.payload.portions.map(p=>p.source.id)).size,3)
 assert.ok(complete.payload.portions.every(p=>p.source.evidence&&p.settlement.evidence))
 assert.equal(complete.payload.payout.evidence,record.evidence)
 const other=await h.cmd('finance.payout.record',{...record,payoutReference:'synthetic-balm-other-envelope'})
 await h.cmd('finance.payout.link',{...link(0),payoutId:other.id,payoutReference:'synthetic-balm-other-envelope'},h.owner,409)
 // A new, correctly matched portion still cannot overallocate the whole original.
 const extra=await h.cmd('finance.source.record',{clientId:patients[0].id,kind:'payout',amountCents:9700,feeCents:300,occurredOn:'2026-09-15',reference:'synthetic-balm-extra-portion',sourceReference:'synthetic-balm-journey-charge-1',evidence:'Synthetic extra original',confirm:true})
 const extraSettlement=await h.cmd('finance.observation.record',{clientId:patients[0].id,kind:'card',amountCents:10000,occurredOn:'2026-09-15',reference:'synthetic-balm-extra-settlement',sourceReference:'synthetic-balm-journey-charge-1',evidence:'Synthetic extra settlement'})
 await h.cmd('finance.payout.link',{...link(0),sourceId:extra.id,observationId:extraSettlement.id},h.owner,409)
 // Even an appended cited source requires a fresh preparation and digest.
 await h.cmd('finance.payout.approve',{id:complete.id,sha256:complete.sha256,confirm:true},h.owner,409)
 const current=find(await prepare())
 assert.deepEqual(current.payload.totals,complete.payload.totals,'unlinked sources do not allocate the payout twice')
 assert.equal(current.payload.portions.length,3,'refused links leave the cited allocation unchanged')
 const key=await h.cmd('agent.create',{label:'Whole payout preparation',scopes:['finance.reconcile.prepare']})
 const agent=await h.send('/api/balm/agent/command',{name:'finance.reconcile.prepare',input:{month:'2026-09'}},'',{authorization:'Bearer '+key.token})
 assert.equal(agent.status,200)
 assert.ok(agent.value.result.payouts.some(r=>r.id===current.id))
 for(const [name,input] of [['finance.payout.record',record],['finance.payout.link',link(0)],['finance.payout.approve',{id:current.id,sha256:current.sha256,confirm:true}]]) {
  assert.equal((await h.send('/api/balm/agent/command',{name,input},'',{authorization:'Bearer '+key.token})).status,403)
 }
 await h.cmd('agent.revoke',{id:key.id})
 assert.equal((await h.send('/api/balm/agent/command',{name:'finance.reconcile.prepare',input:{month:'2026-09'}},'',{authorization:'Bearer '+key.token})).status,401)
 assert.equal(h.outboundRequests.length,outbound,'recording, linking, preparation and approval never call providers')
 const reception=await h.staff('PayoutDesk','reception'),biller=await h.staff('PayoutBiller','biller')
 for(const actor of [reception,biller]) {
  for(const [name,input] of [['finance.payout.record',record],['finance.payout.link',link(0)],['finance.payout.approve',{id:current.id,sha256:current.sha256,confirm:true}],['finance.reconcile.prepare',{month:'2026-09'}]])await h.cmd(name,input,actor.cookie,403)
  assert.equal((await h.send('/api/balm/finance/payouts?month=2026-09',undefined,actor.cookie)).status,403)
 }
 const revoked=await h.signIn(h.auth.OWNER_EMAIL)
 const session=(await h.send('/auth/security',undefined,revoked,{accept:'application/json'})).value.currentSessionId
 assert.equal((await h.send('/auth/security/revoke',{sessionId:session},h.owner)).status,200)
 await h.cmd('finance.payout.approve',{id:current.id,sha256:current.sha256,confirm:true},revoked,401)
 await h.cmd('finance.payout.record',record,revoked,401)
 assert.equal((await h.send('/api/balm/finance/payouts?month=2026-09',undefined,revoked)).status,401)
 await h.cmd('finance.payout.approve',{id:current.id,sha256:current.sha256,confirm:true})
 const view=(await h.send('/api/balm/finance/payouts?month=2026-09',undefined,h.owner)).value
 assert.equal(view.reviews.find(r=>r.id===partial.id).sha256,partial.sha256)
 assert.ok(view.reviews.find(r=>r.id===partial.id).approved_at,'historical approval remains fixed after new links')
 for(const patient of patients) {
  const file=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value
  assert.equal(file.billing.ledger.balanceCents,0)
  assert.equal(file.billing.payments.length,0)
  await h.cmd('client.erase',{id:patient.id},h.owner,409)
 }
}

/** Native recording, linking and exact-digest approval in the existing report panel. */
export async function payoutBrowser(h) {
 if(!process.env.BALM_UI_SCREENSHOTS){
  const {mkdtemp}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
  process.env.BALM_UI_SCREENSHOTS=await mkdtemp(join(tmpdir(),'balm-finance-ui-'))
 }
 const {payout,record,portions}=await payoutFixture(h,'browser')
 const {viewportProof}=await import('./viewport-proof.mjs')
 const path='/app/reports?payoutMonth=2026-09#finance-reconciliation'
 const fill=async page=>{
  const form=page.locator('form').filter({has:page.getByRole('button',{name:'Record whole payout',exact:true})})
  for(const [name,value] of Object.entries({accountReference:record.accountReference,payoutReference:'synthetic-balm-browser-form',gross:'350.00',fee:'10.50',net:'339.50',occurredOn:record.occurredOn,evidence:'Synthetic form original reviewed by owner'}))await form.locator('[name='+name+']').fill(value)
  await form.locator('[name=confirm]').check()
  return form
 }
 await viewportProof(h,[{name:'finance-payout-recording',path,cookie:h.owner,selector:'#finance-reconciliation',interact:async({page,width})=>{
  const details=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^Record whole payout$/})})
  if(!await details.evaluate(el=>el.open))await details.locator('summary').click()
  await fill(page)
  if(width===1440){
   const small=await page.locator('#finance-reconciliation *').evaluateAll(els=>els.filter(el=>el.getClientRects().length&&[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(el).fontSize)<13).map(el=>({text:el.textContent,size:getComputedStyle(el).fontSize})))
   assert.deepEqual(small,[])
  }
 }}])
 await viewportProof(h,[{name:'finance-payout-approved-comparison',path,cookie:h.owner,selector:'#finance-reconciliation',interact:async({page,width})=>{
  if(width===1440){
   await page.locator('summary').filter({hasText:/^Record whole payout$/}).click()
   const form=await fill(page)
   await form.getByRole('button',{name:'Record whole payout',exact:true}).click()
   await page.getByRole('heading',{name:'synthetic-balm-browser-form',exact:true}).waitFor()
   for(const portion of portions.slice(0,2)){
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:'synthetic-balm-browser-form',exact:true})})
    await card.locator('summary').filter({hasText:/^Link existing portion$/}).click()
    await card.locator('[name=sourceId]').selectOption(portion.sourceId)
    await card.locator('[name=observationId]').selectOption(portion.observationId)
    await card.locator('[name=confirm]').check()
    await card.getByRole('button',{name:'Link portion',exact:true}).click()
    await page.getByRole('heading',{name:'synthetic-balm-browser-form',exact:true}).waitFor()
   }
   await page.getByRole('button',{name:'Prepare cited comparisons',exact:true}).click()
   await page.getByRole('heading',{name:'Comparison · synthetic-balm-browser-form',exact:true}).waitFor()
  }
  const comparison=page.locator('article').filter({has:page.getByRole('heading',{name:'Comparison · synthetic-balm-browser-form',exact:true})}).first()
  await comparison.locator('summary').filter({hasText:/^Cited originals and approval$/}).click()
  if(width===1440){
   assert.match(await comparison.textContent(),/Linked gross \$300\.00 · fees \$9\.00 · net \$291\.00/)
   assert.match(await comparison.textContent(),/Unallocated gross \$50\.00 · fees \$1\.50 · net \$48\.50/)
   assert.ok((await comparison.textContent()).includes('synthetic-balm-browser-settlement-1'))
   await comparison.locator('[name=confirm]').check()
   await comparison.getByRole('button',{name:'Approve preparation',exact:true}).click()
   await page.getByText('Preparation approved',{exact:true}).waitFor()
   await page.locator('article').filter({has:page.getByRole('heading',{name:'Comparison · synthetic-balm-browser-form',exact:true})}).first().locator('summary').click()
  }
  await comparison.evaluate(el=>el.scrollIntoView({block:'start'}))
 }}])
 const saved=(await h.send('/api/balm/finance/payouts?month=2026-09',undefined,h.owner)).value
 const formPayout=saved.payouts.find(p=>p.payout_reference==='synthetic-balm-browser-form')
 const review=saved.reviews.find(r=>r.payout_id===formPayout.id)
 assert.ok(review.approved_at)
 assert.equal(review.payload.totals.unallocatedNetCents,4850)
 assert.equal(saved.reviews.find(r=>r.payout_id===payout.id).payload.totals.unallocatedGrossCents,35000,'unlinked whole originals remain independent')
 console.log('PASS native payout recording, cited portions and preparation approval at 1440 and 390')
}
