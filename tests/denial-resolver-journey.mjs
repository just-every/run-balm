import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {clinic,pastVisit} from './clinic.mjs'
const fixture=async(name,claim)=>(await readFile(new URL('./fixtures/insurance/'+name,import.meta.url),'utf8')).replaceAll('{{CLAIM}}',claim)
export async function denialFixture(h){
 await h.finishSetup()
 const {service,practitioners:[priya]}=await clinic(h)
 await h.cmd('staff.save',{id:priya.id,name:'Priya Shah',email:priya.email,role:'practitioner',credentials:'PT',active:true})
 await h.cmd('pay.npi.save',{staffId:priya.id,npi:'1234567893'})
 await h.cmd('insurance.settings.save',{billingNpi:'1234567893',taxId:'123456789',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',senderId:'BALMTEST',contactName:'Jordan Clinic',contactPhone:'5125550100'})
 const payer=await h.cmd('insurance.payer.save',{name:'Aetna',payerId:'60054',receiverId:'AETNA',unitMethod:'cms',fees:[{code:'97110',cents:3500},{code:'97140',cents:2500}]})
 await h.cmd('insurance.enrollment.save',{payerId:payer.id,practitionerId:priya.id,taxonomy:'225100000X',active:true})
 const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Denial',dateOfBirth:'1988-04-02'})
 const coverage={startsOn:'2000-01-01',endsOn:'2099-12-31'}
 const policy=await h.cmd('insurance.policy.save',{clientId:patient.id,payerId:payer.id,memberId:'synthetic-balm-1',relationship:'18',patientSex:'F',address:'200 Oak St',city:'Austin',state:'TX',postalCode:'78701',...coverage})
 const visit=await pastVisit(h,patient.id,priya,service.id)
 await h.cmd('appointment.attend',{id:visit})
 const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Synthetic therapy: knee strength improved with skilled manual therapy.',charges:[{code:'97110',minutes:23},{code:'97140',minutes:15}]},priya.cookie)
 await h.cmd('note.sign',{id:note.id,revision:1,signature:'Priya Shah',attest:true},priya.cookie)
 await h.cmd('pay.codes.save',{appointmentId:visit,icd10:'M25.561'})
 const invoice=await h.cmd('invoice.prepare',{appointmentId:visit});await h.cmd('invoice.approve',{id:invoice.id})
 const claim=await h.cmd('insurance.claim.prepare',{appointmentId:visit,policyId:policy.id})
 assert.equal(claim.status,'ready')
 const batch=await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]})
 await h.send('/api/balm/insurance/837P/'+batch.id,undefined,h.owner)
 const referral=await h.cmd('case.open',{clientId:patient.id,policyId:policy.id,receivedOn:'2000-01-01',referringFirst:'Synthetic',referringLast:'Provider'})
 const biller=await h.staff('AppealBiller','biller'),reception=await h.staff('AppealReception','reception')
 const view=async(cookie=h.owner)=>{const response=await h.send('/api/balm/cases',undefined,cookie);assert.equal(response.status,200,response.text);return response.value.cases.find(c=>c.referral.id===referral.id)}
 const reject=async()=>h.cmd('insurance.acknowledgment.import',{payerId:payer.id,x12:(await fixture('277CA.x12',claim.id)).replace('A2:20','A3:21')})
 const detailed=body=>{const paid=body.includes('EFTPAID001'),extra=`LQ*HE*${paid?'M15':'N54'}~SVC*HC:97110:GP*70*${paid?'45':'0'}**2~REF*6R*synthetic-balm-4~DTM*573*20261017~SVC*HC:97140:GP*25*${paid?'15':'0'}**1~REF*6R*synthetic-balm-5~DTM*573*20261017~`;return body.replace(/SE\*\d+\*/,extra+'SE*'+(body.split('~').filter(v=>v.trim()).length+7)+'*')}
 const deny=async()=>h.cmd('insurance.remittance.import',{payerId:payer.id,x12:detailed(await fixture('835-denied.x12',claim.id))})
 const authorize=async()=>h.cmd('insurance.authorization.save',{policyId:policy.id,number:'synthetic-balm-2',...coverage,visits:12})
 const prepare=async auth=>h.cmd('case.appeal.prepare',{caseId:referral.id,claimId:claim.id,authorizationId:auth.id},biller.cookie)
 const approveRelease=async packet=>{assert.equal((await h.send('/api/balm/note-releases/'+packet.releaseId+'.pdf',undefined,h.owner)).status,200);return h.cmd('note_release.approve',{id:packet.releaseId,sha256:packet.releaseDigest,attest:true})}
 const download=async packet=>h.send('/api/balm/note-releases/'+packet.releaseId+'.pdf',undefined,biller.cookie)
 const pay=async()=>h.cmd('insurance.remittance.import',{payerId:payer.id,x12:detailed(await fixture('835-paid.x12',claim.id))})
 return {patient,payer,policy,visit,note,invoice,claim,referral,biller,reception,priya,view,reject,deny,authorize,prepare,approveRelease,download,pay}
}
export async function denialJourney(h,{capture=async()=>{}}={}){
 const c=await denialFixture(h)
 await c.reject()
 const rejection=(await c.view()).steps.find(s=>s.kind==='denial.fix')
 assert.match(rejection.why,/A3:21/,'277CA original codes explain the rejection')
 assert.deepEqual(rejection.citations.map(x=>x.kind).sort(),['claim','note','visit'],'277CA never invents an ERA')
 await capture('rejected',c)
 await c.deny();const auth=await c.authorize(),packet=await c.prepare(auth)
 for(const cookie of [c.reception.cookie,c.priya.cookie])await h.cmd('case.appeal.prepare',{caseId:c.referral.id,claimId:c.claim.id,authorizationId:auth.id},cookie,403)
 const proposed=(await c.view(c.biller.cookie)).appeals.find(a=>a.id===packet.id)
 assert.equal(proposed.resolution,'awaiting_payment')
 assert.match(proposed.wording,/197/);assert.match(proposed.wording,/synthetic-balm-2/)
 assert.deepEqual(proposed.citations,[
  {kind:'claim',href:`/app/clients/${c.patient.id}#claim-${c.claim.id}`,label:`Claim ${c.claim.id}`},
  {kind:'era',href:`/app/clients/${c.patient.id}#claim-${c.claim.id}`,label:`835 adjudication ${packet.eventId}`},
  {kind:'note',href:`/app/clients/${c.patient.id}#note-${c.note.id}`,label:'Signed treatment note'},
  {kind:'authorization',href:`/app/clients/${c.patient.id}#authorization-${auth.id}`,label:'Authorization synthetic-balm-2'}
 ],'each exact citation points to the denial records')
 const input={id:packet.id,digest:packet.digest},approve=(cookie=c.biller.cookie,status=200)=>h.cmd('case.appeal.approve',input,cookie,status)
 await approve(c.biller.cookie,403)
 assert.equal((await c.download(packet)).status,403)
 await c.approveRelease(packet);await approve(c.biller.cookie,403)
 const pdf=await c.download(packet);assert.equal(pdf.status,200);assert.match(pdf.text,/knee strength improved/)
 for(const cookie of ['',c.reception.cookie,c.priya.cookie])await approve(cookie,cookie?403:401)
 const key=await h.cmd('agent.create',{label:'synthetic-balm-3'})
 assert.equal((await h.send('/api/balm/agent/command',{name:'case.appeal.approve',input},'',{authorization:'Bearer '+key.token})).status,403)
 await h.cmd('staff.save',{id:c.biller.id,name:'AppealBiller',email:'appealbiller@clinic.example',role:'biller',active:false})
 await approve(c.biller.cookie,403)
 await h.cmd('staff.save',{id:c.biller.id,name:'AppealBiller',email:'appealbiller@clinic.example',role:'biller',active:true})
 await h.cmd('case.appeal.approve',{...input,digest:'stale'},c.biller.cookie,409)
 await capture('prepared',c,packet)
 const mailBefore=h.mail.length
 const race=await Promise.all([h.send('/api/balm/command',{name:'case.appeal.approve',input},c.biller.cookie),h.send('/api/balm/command',{name:'case.appeal.approve',input},c.biller.cookie)])
 assert.deepEqual(race.map(r=>r.status).sort(),[200,409])
 const approved=(await c.view()).appeals.find(a=>a.id===packet.id)
 assert.equal(approved.status,'done');assert.equal(approved.approved_by,'appealbiller@clinic.example');assert.equal(approved.wording,proposed.wording);assert.equal(approved.digest,packet.digest);assert.equal(approved.result.releaseDigest,packet.releaseDigest)
 assert.equal(approved.resolution,'awaiting_payment','approval cannot resolve a denial');assert.equal(h.mail.length,mailBefore,'approval sends nothing')
 await capture('approved',c,packet)
 const revoked=await c.prepare(auth);await c.approveRelease(revoked);await c.download(revoked);await h.cmd('note_release.revoke',{id:revoked.releaseId})
 assert.equal((await c.download(revoked)).status,403)
 await h.cmd('case.appeal.approve',{id:revoked.id,digest:revoked.digest},c.biller.cookie,403)
 const expired=await c.prepare(auth)
 await h.db.prepare('INSERT INTO bm_note_release_approvals(release_id,sha256,approved_at,approved_by,expires_at) VALUES(?,?,?,?,?)').bind(expired.releaseId,expired.releaseDigest,'2000-01-01T00:00:00.000Z',h.auth.OWNER_EMAIL,'2000-01-08T00:00:00.000Z').run()
 await h.db.prepare('INSERT INTO bm_audit(at,actor_email,actor_role,action,client_id,subject_id,detail) VALUES(?,?,?,?,?,?,?)').bind('2000-01-02T00:00:00.000Z','appealbiller@clinic.example','biller','note_release.downloaded',c.patient.id,expired.releaseId,'Historical evidence download').run()
 assert.equal((await c.download(expired)).status,403)
 await h.cmd('case.appeal.approve',{id:expired.id,digest:expired.digest},c.biller.cookie,403)
 await c.pay();await c.pay()
 const resolved=(await c.view()).appeals.find(a=>a.id===packet.id)
 assert.equal(resolved.resolution,'resolved');assert.equal(resolved.wording,proposed.wording)
 const file=(await h.send('/api/balm/clients/'+c.patient.id,undefined,h.owner)).value
 assert.equal(file.billing.ledger.paymentsCents,6000);assert.equal(file.billing.ledger.patientBalanceCents,1500)
 const originals=(await h.db.prepare("SELECT detail FROM bm_claim_events WHERE claim_id=? AND kind='835' ORDER BY rowid").bind(c.claim.id).all()).results.map(r=>JSON.parse(r.detail))
 assert.deepEqual(originals,[{id:c.claim.id,status:'4',chargeCents:9500,paidCents:0,prCents:0,control:'PAYERDENIED001',adjustments:[{group:'CO',reason:'197',amountCents:9500,line:null}],remarks:['N54'],lines:[{code:'97110',modifiers:['GP'],units:2,chargeCents:7000,paidCents:0,adjustments:[],adjudicatedOn:'2026-10-17',reference:'synthetic-balm-4'},{code:'97140',modifiers:['GP'],units:1,chargeCents:2500,paidCents:0,adjustments:[],adjudicatedOn:'2026-10-17',reference:'synthetic-balm-5'}]},{id:c.claim.id,status:'1',chargeCents:9500,paidCents:6000,prCents:1500,control:'PAYERPAID001',adjustments:[{group:'CO',reason:'45',amountCents:2000,line:null},{group:'PR',reason:'3',amountCents:1500,line:null}],remarks:['M15'],lines:[{code:'97110',modifiers:['GP'],units:2,chargeCents:7000,paidCents:4500,adjustments:[],adjudicatedOn:'2026-10-17',reference:'synthetic-balm-4'},{code:'97140',modifiers:['GP'],units:1,chargeCents:2500,paidCents:1500,adjustments:[],adjudicatedOn:'2026-10-17',reference:'synthetic-balm-5'}]}],'complete original adjudications survive payment')
 const audits=(await h.db.prepare('SELECT action FROM bm_audit WHERE client_id=?').bind(c.patient.id).all()).results.map(r=>r.action)
 for(const action of ['case.list_read','case.appeal_prepared','case.appeal_approved','note_release.prepared','note_release.reviewed','note_release.approved','note_release.downloaded','note_release.revoked'])assert.ok(audits.includes(action),action)
 await capture('paid',c,packet)
 return {...c,packet,proposed,originals}
}
