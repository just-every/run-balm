import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {harness} from './harness.mjs'
import {clinic,pastVisit,visitDate} from './clinic.mjs'
import {payerEobPdf} from './manual-payer-journey.mjs'
const year=new Date().getUTCFullYear(),coverage={startsOn:`${year-1}-01-01`,endsOn:`${year+1}-12-31`}
const era=(claim,payer,lines,{status='1',forward,trace='synthetic-balm-20'}={})=>{
 const total=key=>lines.reduce((t,l)=>t+l[key],0),parts=[`ST*835*0001*005010X221A1`,`BPR*I*${total('paid')/100}*C*CHK************${claim.snapshot.serviceDate.replace(/-/g,'')}`,`TRN*1*${trace}*1234567890`,`N1*PR*${payer.name}*XV*${payer.code}`,`N1*PE*SYNTHETIC CLINIC*XX*1234567893`,`CLP*${claim.id}*${status}*${total('charge')/100}*${total('paid')/100}*${total('pr')/100}*CI*${trace}-control`]
 if(forward)parts.push(`NM1*TT*2*${forward.name}*****PI*${forward.code}`)
 for(const l of lines){parts.push(`SVC*HC:${l.code}:GP*${l.charge/100}*${l.paid/100}**${l.units}`);if(l.co)parts.push(`CAS*CO*45*${l.co/100}`);if(l.pr)parts.push(`CAS*PR*3*${l.pr/100}`)}
 return [...parts,`SE*${parts.length+1}*0001`].join('~')+'~'
}
export async function cobJourney(h,output,hooks={}) {
 await h.finishSetup()
 const {service,practitioners:[priya]}=await clinic(h)
 await h.cmd('staff.save',{id:priya.id,name:'Priya Shah',email:priya.email,role:'practitioner',credentials:'PT',active:true})
 await h.cmd('pay.npi.save',{staffId:priya.id,npi:'1234567893'})
 await h.cmd('insurance.settings.save',{billingNpi:'1234567893',taxId:'123456789',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',senderId:'SYNTHETIC',contactName:'Clinic billing',contactPhone:'5125550100'})
 const biller=await h.staff('CobBiller','biller'),reception=await h.staff('CobReception','reception')
 const payerNames={1:'Blue Cedar Health',2:'Harbor Mutual',3:'Valley Benefits',4:'Medicare'}
 const payer=async(n,unitMethod='cms',medicare=false)=>{
  const saved=await h.cmd('insurance.payer.save',{name:payerNames[n],payerId:`9999${n}`,receiverId:`PAYER${n}`,unitMethod,medicare,fees:[{code:'97110',cents:3500},{code:'97140',cents:2500}]})
  await h.cmd('insurance.enrollment.save',{payerId:saved.id,practitionerId:priya.id,taxonomy:'225100000X',active:true})
  return {...saved,name:payerNames[n],code:`9999${n}`,medicare}
 }
 const primary=await payer(1),secondary=await payer(2,'ama'),tertiary=await payer(3,'ama'),medicare=await payer(4,'cms',true)
 await h.cmd('insurance.medicare.settings.save',{year,therapyGroup:'pt_slp',thresholdCents:250000,reviewCents:300000,publishedOn:`${year-1}-10-30`,source:'CMS synthetic-year threshold fixture'})
 const command=(name,input,status=200)=>h.cmd(name,input,biller.cookie,status)
 let visitNumber=0
 const prepare=async(label,payers)=>{
  const names={CommercialCob:['Maya','Lee'],Crossover:['Elena','Harris'],PaperCob:['Jordan','Rivera']}[label]
  const patient=await h.cmd('client.save',{firstName:names[0],lastName:names[1],dateOfBirth:'1988-04-02'})
  const policies=[]
  for(const [n,p] of payers.entries())policies.push(await command('insurance.policy.save',{clientId:patient.id,payerId:p.id,memberId:`synthetic-balm-${n+1}`,planName:payers[0].medicare&&n===1?'Medigap Plan G':'',priority:n+1,relationship:'18',patientSex:'F',address:'200 Oak St',city:'Austin',state:'TX',postalCode:'78701',...coverage}))
  const appointmentId=await pastVisit(h,patient.id,priya,service.id,h.owner,2+visitNumber++),serviceDate=await visitDate(h,appointmentId)
  await h.cmd('appointment.attend',{id:appointmentId})
  const note=await h.cmd('note.write',{clientId:patient.id,appointmentId,body:'Synthetic therapy visit with skilled progression.',charges:[{code:'97110',minutes:8},{code:'97140',minutes:8,cmsTieChosen:true}]},priya.cookie)
  await h.cmd('note.sign',{id:note.id,revision:1,signature:'Priya Shah',attest:true},priya.cookie)
  await h.cmd('pay.codes.save',{appointmentId,icd10:'M25.561'})
  const invoice=await h.cmd('invoice.prepare',{appointmentId});await h.cmd('invoice.approve',{id:invoice.id})
  const claim=await command('insurance.claim.prepare',{appointmentId,policyId:policies[0].id})
  assert.equal(claim.status,'ready',JSON.stringify(claim.errors))
  return {patient,policies,appointmentId,serviceDate,invoice,claim}
 }
 const file=async c=>(await h.send('/api/balm/clients/'+c.patient.id,undefined,h.owner)).value
 const submit=async claim=>{const batch=await command('insurance.batch.prepare',{claimIds:[claim.id]});const result=await command('insurance.batch.submit',{id:batch.id});assert.equal(result.status,'submitted');return (await h.send('/api/balm/insurance/837P/'+batch.id,undefined,biller.cookie)).text}
 const close=async()=>(await h.state()).dailyClose
 const c=await prepare('CommercialCob',[primary,secondary,tertiary])
 await submit(c.claim)
 const primaryLines=[{code:'97140',charge:2500,paid:1000,co:1000,pr:500,units:1}]
 await command('insurance.remittance.import',{payerId:primary.id,x12:era(c.claim,primary,primaryLines)})
 assert.equal((await file(c)).billing.ledger.patientBalanceCents,0)
 assert.equal((await file(c)).billing.ledger.insurancePendingCents,500)
 await hooks.held?.({h,c,biller})
 await command('payment.record',{invoiceId:c.invoice.id,amountCents:100,reference:'synthetic-balm-21'},409)
 assert.ok((await close()).claims.some(q=>q.clientId===c.patient.id&&q.kind==='unsent_next_payer'))
 const next=await command('insurance.claim.prepare',{appointmentId:c.appointmentId,policyId:c.policies[1].id})
 assert.equal(next.status,'ready',JSON.stringify(next.errors));assert.equal(next.snapshot.lines.reduce((t,l)=>t+l.units,0),2);assert.deepEqual(next.snapshot.cob.primaryUnits,[{code:'97140',units:1}])
 const nextBatch=await command('insurance.batch.prepare',{claimIds:[next.id]})
 const exported=await h.send('/api/balm/insurance/837P/'+nextBatch.id,undefined,biller.cookie);assert.equal(exported.status,200)
 assert.ok((await close()).claims.some(q=>q.id===next.id),'Export stays unsent in daily close')
 await command('insurance.batch.submit',{id:nextBatch.id})
 assert.ok(!(await close()).claims.some(q=>q.id===next.id))
 const x12=exported.text
 assert.match(x12,/SBR\*S\*/);assert.match(x12,/AMT\*D\*10.00/);assert.match(x12,/SVD\*99991\*10.00\*HC:97140:GP\*\*1/);assert.ok(x12.includes('DTP*573*D8*'+c.serviceDate.replace(/-/g,'')))
 const secondaryLines=[{code:'97110',charge:3500,paid:100,co:3300,pr:100,units:1},{code:'97140',charge:2500,paid:200,co:2200,pr:100,units:1}]
 await command('insurance.remittance.import',{payerId:secondary.id,x12:era(next,secondary,secondaryLines,{status:'2',trace:'synthetic-balm-22'})})
 assert.equal((await file(c)).billing.ledger.patientBalanceCents,0)
 const third=await command('insurance.claim.prepare',{appointmentId:c.appointmentId,policyId:c.policies[2].id})
 assert.equal(third.status,'ready',JSON.stringify(third.errors));assert.equal(third.snapshot.cob.prior.length,2)
 const x123=await submit(third);assert.match(x123,/SBR\*T\*/);assert.match(x123,/SVD\*99991/);assert.match(x123,/SVD\*99992/)
 const tertiaryLines=[{code:'97110',charge:3500,paid:50,co:3400,pr:50,units:1},{code:'97140',charge:2500,paid:50,co:2400,pr:50,units:1}]
 await command('insurance.remittance.import',{payerId:tertiary.id,x12:era(third,tertiary,tertiaryLines,{status:'3',trace:'synthetic-balm-23'})})
 assert.equal((await file(c)).billing.ledger.patientBalanceCents,100)
 assert.equal((await file(c)).billing.ledger.insurancePendingCents,0)
 await hooks.released?.({h,c,biller})
 const crossed=await prepare('Crossover',[medicare,secondary]);await submit(crossed.claim)
 for(const status of ['19','20','21']){
  const bad=era(crossed.claim,medicare,primaryLines,{status,forward:{...secondary,code:'00000'},trace:'synthetic-balm-'+status})
  const refusal=await command('insurance.remittance.import',{payerId:medicare.id,x12:bad},400);assert.match(refusal.code,/crossover_carrier/)
 }
 await command('insurance.remittance.import',{payerId:medicare.id,x12:era(crossed.claim,medicare,primaryLines,{status:'19',forward:secondary,trace:'synthetic-balm-24'})})
 assert.equal((await file(crossed)).insurance.claims.length,1)
 await command('insurance.claim.prepare',{appointmentId:crossed.appointmentId,policyId:crossed.policies[1].id},409)
 await command('insurance.remittance.import',{payerId:secondary.id,x12:era(crossed.claim,secondary,[{code:'97140',charge:2500,paid:300,co:2000,pr:200,units:1}],{status:'2',trace:'synthetic-balm-25'})})
 assert.equal((await file(crossed)).insurance.claims.length,1);assert.equal((await file(crossed)).billing.ledger.patientBalanceCents,200)
 await h.cmd('insurance.cob.read',{},reception.cookie,403)
 const manual=await prepare('PaperCob',[primary,secondary]);await submit(manual.claim)
 const batch=await command('insurance.payer_batch.prepare',{payerId:primary.id,reference:'synthetic-balm-26',depositOn:manual.serviceDate,amountCents:1000})
 await command('insurance.payer_line.add',{batchId:batch.id,kind:'payment',claimId:manual.claim.id,billedCents:2500,allowedCents:1500,paidCents:1000,adjustments:[{group:'CO',reason:'45',amountCents:1000},{group:'PR',reason:'3',amountCents:500}],reason:'Synthetic original line',procedureCode:'97140',procedureModifiers:['GP'],paidUnits:1,adjudicatedOn:manual.serviceDate,payerControl:'synthetic-balm-27'})
 await command('insurance.payer_eob.attach',{batchId:batch.id,attachment:'data:application/pdf;base64,'+payerEobPdf.toString('base64'),attachmentName:'synthetic-eob.pdf',attest:true})
 await command('insurance.payer_batch.close',{id:batch.id,attest:true})
 assert.equal((await file(manual)).billing.ledger.patientBalanceCents,0)
 const paperClaim=await command('insurance.claim.prepare',{appointmentId:manual.appointmentId,policyId:manual.policies[1].id})
 assert.equal(paperClaim.status,'ready',JSON.stringify(paperClaim.errors))
 const packet=hooks.paperPrepare?await hooks.paperPrepare({h,manual,paperClaim,biller,eob:payerEobPdf}):await command('insurance.cob.paper.prepare',{claimId:paperClaim.id,attachment:'data:application/pdf;base64,'+payerEobPdf.toString('base64'),attachmentName:'synthetic-primary-eob.pdf',attest:true})
 const printed=await h.send('/api/balm/insurance/paper/'+packet.id,undefined,biller.cookie);assert.equal(printed.status,200);assert.match(printed.text,/CMS-1500/)
 const eob=await h.send('/api/balm/insurance/paper-eob/'+packet.id,undefined,biller.cookie);assert.equal(eob.status,200);assert.equal(Buffer.from(eob.text).subarray(0,5).toString(),'%PDF-')
 assert.ok((await close()).claims.some(q=>q.id===paperClaim.id),'Printing remains unsent')
 if(hooks.paperSubmit)await hooks.paperSubmit({h,manual,paperClaim,biller,packet})
 else await command('insurance.cob.paper.submit',{id:packet.id,reference:'synthetic-balm-28',attest:true})
 assert.ok(!(await close()).claims.some(q=>q.id===paperClaim.id))
 if(output){await mkdir(output,{recursive:true});await writeFile(output+'/secondary.x12',x12);await writeFile(output+'/tertiary.x12',x123)}
 return {biller,c,crossed,manual,paperClaim,packet}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 const h=await harness({auth:{BALM_INSURANCE_ADAPTER_URL:'https://clearinghouse.clinic.example/x12',BALM_INSURANCE_ADAPTER_TOKEN:'synthetic-balm-30'},outbound:async request=>{assert.equal(request.url,'https://clearinghouse.clinic.example/x12');assert.equal(request.headers.get('authorization'),'Bearer synthetic-balm-30');return Response.json({status:'submitted',reference:'synthetic-balm-31'})}})
 try{await cobJourney(h,process.env.BALM_COB_VALIDATION);console.log('INS-013 public-door journey passed')}finally{await h.close()}
}
