// Native-format synthetic files at CMS's network edge only. No production code
// depends on these records; CPT fixture descriptions are synthetic, never AMA text.
import assert from 'node:assert/strict'
import {deflateRawSync} from 'node:zlib'
const pages={icd10:'https://www.cms.gov/medicare/coding-billing/icd-10-codes',hcpcs:'https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update',ptp:'https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-procedure-procedure-ptp-edits',mue:'https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-medically-unlikely-edits-mues'}
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0})
function zip(name,content){
 const plain=Buffer.from(content),body=deflateRawSync(plain),filename=Buffer.from(name);let crc=0xffffffff
 for(const byte of plain)crc=crcTable[(crc^byte)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(plain.length,22);local.writeUInt16LE(filename.length,26)
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(plain.length,24);central.writeUInt16LE(filename.length,28)
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+filename.length,12);end.writeUInt32LE(30+filename.length+body.length,16)
 return Buffer.concat([local,filename,body,central,filename,end])
}
const ptpFile=(rows)=>'"Synthetic CMS-format copyright banner\r\nnot licensed AMA descriptors"\t\t\r\nColumn 1\tColumn 2\tPrior\tEffective\tDeletion\tModifier\r\n'+rows.join('\r\n')+'\r\n'
const icdRow=(n,code,billable,description)=>String(n).padStart(5,'0')+' '+code.padEnd(7)+' '+billable+' '+description.slice(0,60).padEnd(60)+' '+description+'\r\n'
function hcpcsRow(){const cells=Array(293).fill(' ');for(const [at,value] of [[0,'G0001'],[5,'00100'],[10,'3'],[11,'Synthetic HCPCS descriptor'],[268,'20260701'],[276,'20260701']])for(let i=0;i<value.length;i++)cells[at+i]=value[i];return cells.join('')+'\r\n'}
export function codeSetEdge(){
 const files=new Map(),requests=[]
 const add=(path,name,body)=>{const url='https://www.cms.gov/files/zip/'+path;files.set(url,zip(name,body));return {url}}
 const ptp=[]
 for(const [quarter,version] of [[3,'v322r0'],[4,'v323r0']]){
  const parts=[]
  for(let part=1;part<=4;part++){
   // CMS's public Q4 additions report lists 00530 / 0932T, indicator 1.
   const rows=part===1?['00530\t00532\t0\t20260701\t*\t0']:part===2?['00531\t00533\t0\t20260701\t20260701\t9']:part===3?[quarter===4?'00530\t0932T\t0\t20261001\t*\t1':'00534\t00535\t0\t20260701\t20261001\t0']:['00536\t00537\t0\t20260701\t20260701\t9']
   parts.push(add(`medicare-ncci-2026q${quarter}-practitioner-ptp-edits-ccipra-${version}-f${part}.zip`,`ccipra-${version}-f${part}.txt`,ptpFile(rows)))
  }
  ptp.push({kind:'ptp',version:quarter===3?'32.2 r0':'32.3 r0',effectiveOn:`2026-${quarter===3?'07':'10'}-01`,files:parts})
 }
 const icdBody=icdRow(1,'M25',0,'Synthetic joint conditions')+icdRow(2,'M25561',1,'Synthetic right knee condition')+icdRow(3,'M25562',1,'Synthetic left knee condition')+['M5450','M79641','M222X1','M23611','R262','R42','R531'].map((code,n)=>icdRow(n+4,code,1,`Synthetic test-only diagnosis ${code}`)).join('')
 const icd=add('2026-code-descriptions-tabular-order.zip','icd10cm_order_2026.txt',icdBody)
 const icdLatest=add('2027-code-descriptions-tabular-order.zip','icd10cm_order_2027.txt',icdBody)
 const hcpcs=add('july-2026-alpha-numeric-hcpcs-file.zip','HCPC2026_JUL_ANWEB.txt',hcpcsRow())
 const mueBody='"Synthetic banner\nsecond line",,,\r\n"HCPCS/\nCPT Code",Practitioner Services MUE Values,MUE Adjudication Indicator,MUE Rationale\r\n00530,2,2 Date of Service Edit: Policy,Synthetic rationale\r\n0932T,1,1 Claim Line Edit,Synthetic rationale\r\n00532,4,3 Date of Service Edit: Clinical,Synthetic rationale\r\n97110,2,2 Date of Service Edit: Policy,Synthetic rationale\r\n'
 const hcpcsLatest=add('october-2026-alpha-numeric-hcpcs-file.zip','HCPC2026_OCT_ANWEB.txt',hcpcsRow())
 const mue=add('medicare-ncci-2026-q3-practitioner-services-mue-table.zip','MCR_MUE_PractitionerServices_Eff_07-01-2026.csv',mueBody)
 const mueLatest=add('medicare-ncci-2026-q4-practitioner-services-mue-table.zip','MCR_MUE_PractitionerServices_Eff_10-01-2026.csv',mueBody)
 return {ptp,icd,icdLatest,hcpcs,hcpcsLatest,mue,mueLatest,requests,handles(url){return Object.values(pages).includes(url)||files.has(url)},async outbound(request){requests.push(request.url);if(Object.values(pages).includes(request.url))return new Response([...files.keys()].map(url=>`<a href="${new URL(url).pathname}">Synthetic CMS linked file</a>`).join('\n'),{headers:{'content-type':'text/html'}});if(files.has(request.url))return new Response(files.get(request.url),{headers:{'content-type':'application/zip'}});return Response.json({error:'Synthetic CMS edge: unknown request'},{status:404})}}
}
export async function installCodeSetFixtures(h,edge){
 const license={licenseAcknowledged:true,licenseBasis:'Synthetic test-only deployment license acknowledgment'}
 for(const release of edge.ptp)await h.cmd('codes.update',{...release,...license})
 await h.cmd('codes.update',{kind:'icd10',version:'FY2026',effectiveOn:'2025-10-01',files:[edge.icd]})
 await h.cmd('codes.update',{kind:'icd10',version:'FY2027',effectiveOn:'2026-10-01',files:[edge.icdLatest]})
 await h.cmd('codes.update',{kind:'hcpcs',version:'2026 Q3',effectiveOn:'2026-07-01',files:[edge.hcpcs]})
 await h.cmd('codes.update',{kind:'mue',version:'2026 Q3',effectiveOn:'2026-07-01',files:[edge.mue],...license})
 await h.cmd('codes.update',{kind:'hcpcs',version:'2026 Q4',effectiveOn:'2026-10-01',files:[edge.hcpcsLatest]})
 await h.cmd('codes.update',{kind:'mue',version:'2026 Q4',effectiveOn:'2026-10-01',files:[edge.mueLatest],...license})
 const timed=['97110','97112','97116','97140','97530','97535','97542','97750','97760','97763','97032','97033','97035','97129']
 const codes=[...timed,'97161','97162','97163','97164','97165','97166','97167','97168','97010','97014','97150','92507','92521','92522','92523','92524','92526','92610','00530','00532','0932T']
 await h.cmd('codes.cpt.import',{version:'Synthetic licensed 2026',effectiveOn:'2026-01-01',...license,mapping:{code:'Code',description:'Descriptor',timed:'Timed'},content:'Code\tDescriptor\tTimed\n'+codes.map(code=>`${code}\tSynthetic test-only descriptor ${code}\t${timed.includes(code)?1:0}`).join('\n')})
 return license
}
/** Run in the public-door harness with {outbound: edge.outbound}. The parent
 * claim journey supplies scrub(input) through the real claim commands. */
export async function codeSetJourney(h,edge,scrub){
 await h.finishSetup();const license=await installCodeSetFixtures(h,edge)
 const before=await h.db.prepare('SELECT (SELECT COUNT(*) FROM bm_code_releases) AS releases,(SELECT COUNT(*) FROM bm_code_items) AS items,(SELECT COUNT(*) FROM bm_audit) AS audit').first()
 const repeated=await h.cmd('codes.update',{...edge.ptp[1],...license})
 assert.equal(repeated.changed,false);assert.equal(repeated.duplicate,true)
 assert.deepEqual(await h.db.prepare('SELECT (SELECT COUNT(*) FROM bm_code_releases) AS releases,(SELECT COUNT(*) FROM bm_code_items) AS items,(SELECT COUNT(*) FROM bm_audit) AS audit').first(),before)
 const header=await h.cmd('codes.search',{kind:'icd10',query:'M25',date:'2026-09-30'})
 assert.equal(header.results.find(c=>c.code==='M25').billable,0)
 await h.cmd('codes.synonym.save',{kind:'icd10',code:'M25.561',term:'synthetic-balm-1'})
 assert.equal((await h.cmd('codes.search',{kind:'icd10',query:'synthetic-balm-1',date:'2026-09-30'})).results[0].code,'M25.561')
 assert.equal(typeof scrub,'function','supply the real public claim creation/scrub adapter')
 const base={diagnoses:['M25.561'],lines:[{code:'00530',units:1,modifiers:[]},{code:'0932T',units:1,modifiers:[]}]}
 const earlier=await scrub({...base,date:'2026-09-30'}),later=await scrub({...base,date:'2026-10-01'})
 assert.ok(!earlier.errors.some(e=>e.code==='ncci_ptp'))
 assert.ok(later.errors.some(e=>e.code==='ncci_ptp'&&e.message.includes('32.3 r0')))
 assert.equal(later.proposals.length,0)
 const headerRefusal=await scrub({...base,date:'2026-10-01',diagnoses:['M25']})
 assert.deepEqual(headerRefusal.errors.find(e=>e.code==='diagnosis_not_billable').children.map(c=>c.code),['M25.561','M25.562'])
 const attested=await scrub({...base,date:'2026-10-01',distinctServices:[{code1:'00530',code2:'0932T',modifier:'59',reason:'Synthetic separate clinically distinct service, recorded by the clinician',attested:true}]})
 assert.deepEqual(attested.proposals.map(p=>[p.code,p.modifier]),[['0932T','59']])
 const fixed=await scrub({...base,date:'2026-10-01',lines:[base.lines[0],{...base.lines[1],modifiers:['59']}],distinctServices:[{code1:'00530',code2:'0932T',modifier:'59',reason:'Synthetic separate clinically distinct service, recorded by the clinician',attested:true}]})
 assert.ok(!fixed.errors.some(e=>e.code==='ncci_ptp'))
 const nonoverride=await scrub({date:'2026-10-01',diagnoses:['M25.561'],lines:[{code:'00530',units:1,modifiers:[]},{code:'00532',units:1,modifiers:['59']}],distinctServices:[{code1:'00530',code2:'00532',modifier:'59',reason:'Synthetic distinct-service rationale cannot bypass indicator zero',attested:true}]})
 assert.ok(nonoverride.errors.some(e=>e.code==='ncci_modifier_not_permitted'))
 const units=await scrub({date:'2026-10-01',diagnoses:base.diagnoses,lines:[{code:'97110',units:3,modifiers:[]}]})
 assert.ok(units.errors.some(e=>e.code==='ncci_mue'&&e.message.includes('MAI 2')))
 await chargeCatalogJourney(h)
}

/** Imported procedures travel through real note, signature, invoice, claim,
 * batching and X12 doors; a payload cannot supply its own catalog metadata. */
export async function chargeCatalogJourney(h) {
 const {clinic,pastVisit,visitDate}=await import('./clinic.mjs')
 const {service,practitioners:[clinician]}=await clinic(h,['synthetic-balm-1'])
 await h.cmd('staff.save',{id:clinician.id,name:'synthetic-balm-1 synthetic-balm-2',email:clinician.email,role:'practitioner',credentials:'PT',active:true})
 await h.cmd('pay.npi.save',{staffId:clinician.id,npi:'1234567893'})
 await h.cmd('insurance.settings.save',{billingNpi:'1234567893',taxId:'123456789',address:'100 synthetic-balm-1',city:'Austin',state:'TX',postalCode:'78701',contactName:'synthetic-balm-1',contactPhone:'5125550100'})
 const payer=await h.cmd('insurance.payer.save',{name:'synthetic-balm-1',payerId:'SYNTHETIC',unitMethod:'cms',fees:[{code:'00530',cents:1000},{code:'0932T',cents:2000}]})
 await h.cmd('insurance.enrollment.save',{payerId:payer.id,practitionerId:clinician.id,taxonomy:'225100000X',active:true})
 const patient=await h.cmd('client.save',{firstName:'synthetic-balm-1',lastName:'synthetic-balm-2',dateOfBirth:'1980-01-01'})
 const visit=await pastVisit(h,patient.id,clinician,service.id),date=await visitDate(h,visit)
 const policy=await h.cmd('insurance.policy.save',{clientId:patient.id,payerId:payer.id,memberId:'synthetic-balm-1',relationship:'18',patientSex:'F',address:'100 synthetic-balm-1',city:'Austin',state:'TX',postalCode:'78701',startsOn:date})
 await h.cmd('appointment.attend',{id:visit})
 await h.cmd('pay.codes.save',{appointmentId:visit,icd10:'M25.561',cpt:'0932T 59'})
 const input={clientId:patient.id,appointmentId:visit,body:'Synthetic independently documented procedures, separate sites and encounters.',charges:[{code:'00530',minutes:0,timed:true,description:'Untrusted descriptor',release:{id:'synthetic-balm-untrusted'}},{code:'0932T',minutes:0}],clinical:{distinctServices:[{code1:'00530',code2:'0932T',modifier:'59',reason:'Synthetic distinct separate procedure, documented and reviewed by the clinician',attested:true}]}}
 await h.cmd('note.write',{...input,charges:[{code:'99999',minutes:0,timed:false,description:'Untrusted nonexistent code'}]},clinician.cookie,409)
 const note=await h.cmd('note.write',input,clinician.cookie)
 const file=(await h.send('/api/balm/clients/'+patient.id,undefined,clinician.cookie)).value
 const recorded=file.notes.find(n=>n.id===note.id).revisions[0].charges
 assert.deepEqual(recorded.map(c=>[c.code,c.timed]),[['00530',false],['0932T',false]])
 assert.equal(recorded[0].description,'Synthetic test-only descriptor 00530')
 assert.notEqual(recorded[0].release.id,'synthetic-balm-untrusted')
 const catalog=await h.cmd('codes.search',{kind:'cpt',query:'00530',date},clinician.cookie)
 assert.equal(recorded[0].release.id,catalog.releaseId)
 await h.cmd('note.sign',{id:note.id,revision:1,signature:'synthetic-balm-1 synthetic-balm-2',credentials:'PT',attest:true},clinician.cookie)
 const invoice=await h.cmd('invoice.prepare',{appointmentId:visit})
 assert.deepEqual(invoice.snapshot.procedures.map(p=>[p.code,p.units]),[['00530',1],['0932T',1]])
 await h.cmd('invoice.approve',{id:invoice.id})
 const claim=await h.cmd('insurance.claim.prepare',{appointmentId:visit,policyId:policy.id})
 assert.equal(claim.status,'ready',JSON.stringify(claim.errors))
 assert.deepEqual(claim.snapshot.lines.map(l=>[l.code,l.units]),[['00530',1],['0932T',1]])
 const batch=await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]})
 const exported=await h.send('/api/balm/insurance/837P/'+batch.id,undefined,h.owner)
 assert.equal(exported.status,200);assert.match(exported.text,/SV1\*HC:00530:GP\*10.00\*UN\*1/);assert.match(exported.text,/SV1\*HC:0932T:59:GP\*20.00\*UN\*1/)
}
