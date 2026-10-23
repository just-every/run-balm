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
   const rows=part===1?['97140\t97530\t0\t20260701\t*\t1']:part===2?['97110\t97112\t0\t20260701\t*\t0']:part===3?[quarter===4?'00530\t0932T\t0\t20261001\t*\t1':'00530\t00532\t0\t20260701\t20261001\t0']:['97535\t97542\t0\t20260701\t20260701\t9']
   parts.push(add(`medicare-ncci-2026q${quarter}-practitioner-ptp-edits-ccipra-${version}-f${part}.zip`,`ccipra-${version}-f${part}.txt`,ptpFile(rows)))
  }
  ptp.push({kind:'ptp',version:quarter===3?'32.2 r0':'32.3 r0',effectiveOn:`2026-${quarter===3?'07':'10'}-01`,files:parts})
 }
 const icd=add('2026-code-descriptions-tabular-order.zip','icd10cm_order_2026.txt',icdRow(1,'M25',0,'Synthetic joint conditions')+icdRow(2,'M25561',1,'Synthetic right knee condition')+icdRow(3,'M25562',1,'Synthetic left knee condition'))
 const hcpcs=add('july-2026-alpha-numeric-hcpcs-file.zip','HCPC2026_JUL_ANWEB.txt',hcpcsRow())
 const mue=add('medicare-ncci-2026-q3-practitioner-services-mue-table.zip','MCR_MUE_PractitionerServices_Eff_07-01-2026.csv','"Synthetic banner\nsecond line",,,\r\n"HCPCS/\nCPT Code",Practitioner Services MUE Values,MUE Adjudication Indicator,MUE Rationale\r\n00530,2,2 Date of Service Edit: Policy,Synthetic rationale\r\n0932T,1,1 Claim Line Edit,Synthetic rationale\r\n97110,4,3 Date of Service Edit: Clinical,Synthetic rationale\r\n')
 return {ptp,icd,hcpcs,mue,requests,async outbound(request){requests.push(request.url);if(Object.values(pages).includes(request.url))return new Response([...files.keys()].map(url=>`<a href="${new URL(url).pathname}">Synthetic CMS linked file</a>`).join('\n'),{headers:{'content-type':'text/html'}});if(files.has(request.url))return new Response(files.get(request.url),{headers:{'content-type':'application/zip'}});return Response.json({error:'Synthetic CMS edge: unknown request'},{status:404})}}
}
export async function installCodeSetFixtures(h,edge){
 const license={licenseAcknowledged:true,licenseBasis:'Synthetic test-only deployment license acknowledgment'}
 for(const release of edge.ptp)await h.cmd('codes.update',{...release,...license})
 await h.cmd('codes.update',{kind:'icd10',version:'FY2026',effectiveOn:'2025-10-01',files:[edge.icd]})
 await h.cmd('codes.update',{kind:'hcpcs',version:'2026 Q3',effectiveOn:'2026-07-01',files:[edge.hcpcs]})
 await h.cmd('codes.update',{kind:'mue',version:'2026 Q3',effectiveOn:'2026-07-01',files:[edge.mue],...license})
 const codes=['00530','00532','0932T','97140','97530','97110','97112','97535','97542']
 await h.cmd('codes.cpt.import',{version:'Synthetic licensed 2026',effectiveOn:'2026-01-01',...license,mapping:{code:'Code',description:'Descriptor',timed:'Timed'},content:'Code\tDescriptor\tTimed\n'+codes.map(code=>`${code}\tSynthetic test-only descriptor ${code}\t${['97140','97530','97110','97112','97535','97542'].includes(code)?1:0}`).join('\n')})
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
 const nonoverride=await scrub({date:'2026-10-01',diagnoses:['M25.561'],lines:[{code:'97110',units:1,modifiers:[]},{code:'97112',units:1,modifiers:['59']}],distinctServices:[{code1:'97110',code2:'97112',modifier:'59',reason:'Synthetic distinct-service rationale cannot bypass indicator zero',attested:true}]})
 assert.ok(nonoverride.errors.some(e=>e.code==='ncci_modifier_not_permitted'))
 const units=await scrub({...base,date:'2026-10-01',lines:[{...base.lines[0],units:3},base.lines[1]]})
 assert.ok(units.errors.some(e=>e.code==='ncci_mue'&&e.message.includes('MAI 2')))
}
