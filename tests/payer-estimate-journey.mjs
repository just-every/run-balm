import assert from 'node:assert/strict'
import {portalLogin} from './portal-billing.mjs'

/** A genuine small PDF fixture representing an original supplied by the payer. */
export function payerEstimatePdf(patient='Maya Payer',member='SYNTHETIC-BALM-2'){
 const content=`BT /F1 16 Tf 50 740 Td (Synthetic payer - Advanced Explanation of Benefits) Tj 0 -30 Td (${patient}) Tj 0 -25 Td (Member ${member}) Tj 0 -25 Td (Expected patient responsibility: $45.00) Tj ET`
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`]
 let pdf='%PDF-1.4\n',offsets=[0]
 objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`})
 const xref=Buffer.byteLength(pdf)
 pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
 return Buffer.from(pdf)
}
export async function payerEstimateJourney(h){
 await h.finishSetup()
 await h.cmd('settings.save',{clinicName:'Riverside Therapy',timeZone:'America/Chicago',taxId:'12-3456789',address:'100 Main St'})
 const patient=await h.cmd('client.save',{firstName:'Maya',lastName:'Payer',dateOfBirth:'1988-04-02',email:'payer-estimate@patient.example'})
 const unrelated=await h.cmd('client.save',{firstName:'Other',lastName:'Payer',dateOfBirth:'1990-01-01',email:'other-payer-estimate@patient.example'})
 const desk=await h.staff('PayerDesk','reception'),biller=await h.staff('PayerBiller','biller')
 const payer=await h.cmd('insurance.payer.save',{name:'Synthetic payer',payerId:'SYNTHETICPAYER'})
 const policyInput={clientId:patient.id,payerId:payer.id,memberId:'synthetic-balm-2',relationship:'18',patientSex:'F',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2020-01-01'}
 const policy=await h.cmd('insurance.policy.save',policyInput)
 const original=payerEstimatePdf(),date=new Date().toISOString().slice(0,10)
 const input={clientId:patient.id,policyId:policy.id,sourceReference:'synthetic-balm-1',sourceDate:date,matchEvidence:'Matched full name, birth date and member ID against the payer original',attachment:'data:application/pdf;base64,'+original.toString('base64'),attachmentName:'synthetic-balm-1.pdf',attest:true}
 const portal=await portalLogin(h,'payer-estimate@patient.example'),foreign=await portalLogin(h,'other-payer-estimate@patient.example')
 const mailBefore=h.mail.length,requestsBefore=h.outboundRequests.length
 await h.cmd('estimate.aeob.prepare',{...input,matchEvidence:''},h.owner,400)
 await h.cmd('estimate.aeob.prepare',{...input,clientId:unrelated.id},h.owner,404)
 for(const cookie of [desk.cookie,biller.cookie])await h.cmd('estimate.aeob.prepare',input,cookie,403)
 const prepared=await h.cmd('estimate.aeob.prepare',input)
 const issue={id:prepared.id,sha256:prepared.sha256,portalConsent:'Patient requested this original in their signed-in portal',attest:true}
 const path='/api/balm/aeobs/'+prepared.id+'.pdf',patientPath='/portal/aeobs/'+prepared.id+'.pdf'
 assert.equal((await h.send(patientPath,undefined,portal)).status,404,'an unreviewed source never reaches the patient portal')
 await h.cmd('estimate.aeob.issue',issue,h.owner,409)
 const downloaded=await h.send(path,undefined,h.owner)
 assert.equal(downloaded.status,200);assert.equal(downloaded.text,original.toString())
 await h.cmd('estimate.aeob.issue',{...issue,sha256:'wrong'},h.owner,409)
 await h.cmd('estimate.aeob.issue',{...issue,portalConsent:''},h.owner,400)
 await h.cmd('estimate.aeob.issue',issue,desk.cookie,403)
 await h.cmd('estimate.aeob.issue',issue)
 await h.cmd('estimate.aeob.issue',issue,h.owner,409)
 assert.equal(h.mail.length,mailBefore,'no outbound notice is sent')
 assert.equal(h.outboundRequests.length,requestsBefore,'recording a supplied original never contacts a payer')
 assert.equal((await h.send(path,undefined,biller.cookie)).status,403)
 assert.equal((await h.send(path,undefined,desk.cookie)).status,403)
 const published=await h.send(patientPath,undefined,portal)
 assert.equal(published.status,200);assert.equal(published.text,original.toString())
 assert.equal((await h.send(patientPath,undefined,foreign)).status,404)
 const signedOut=await h.send(patientPath)
 assert.equal(signedOut.status,303);assert.equal(signedOut.headers.get('location'),'/portal')
 assert.ok((await h.send('/portal/home',undefined,portal)).text.includes(patientPath))
 const file=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value
 assert.ok(file.aeobs.find(a=>a.id===prepared.id).issued_at)
 assert.equal((await h.send('/api/balm/clients/'+patient.id,undefined,desk.cookie)).value.aeobs,null)
 const stale=await h.cmd('estimate.aeob.prepare',{...input,sourceReference:'synthetic-balm-3'})
 await h.send('/api/balm/aeobs/'+stale.id+'.pdf',undefined,h.owner)
 await h.cmd('insurance.policy.save',{...policyInput,id:policy.id,memberId:'synthetic-balm-4'})
 await h.cmd('estimate.aeob.issue',{...issue,id:stale.id,sha256:stale.sha256},h.owner,409)
 assert.equal((await h.send(patientPath,undefined,portal)).text,original.toString(),'later policy edits cannot rewrite the payer original')
 await h.cmd('retention.save',{state:'AZ',adultYears:6,minorYears:6,payerYears:0,majorityAge:18})
 assert.ok((await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.retention.reasons.includes('good_faith_estimate_six_year_retention'))
 const audit=(await h.db.prepare("SELECT action FROM bm_audit WHERE client_id=? AND action LIKE 'aeob.%'").bind(patient.id).all()).results
 for(const action of ['aeob.prepared','aeob.original_reviewed','aeob.issued','aeob.downloaded'])assert.ok(audit.some(a=>a.action===action))
 return {patient,policy,prepared,path,patientPath,portal,original}
}
