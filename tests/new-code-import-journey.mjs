// Native CMS-format bytes at the HTTPS edge; the Worker owns every saved row.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { run } from './harness.mjs'

function archive(name, content, corrupt = false) {
 const plain=Buffer.from(content),body=deflateRawSync(plain),filename=Buffer.from(name)
 let crc=0xffffffff
 for(const byte of plain){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1}
 crc=(crc^0xffffffff)>>>0
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(plain.length,22);local.writeUInt16LE(filename.length,26)
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(8,10);central.writeUInt32LE(corrupt?(crc^1)>>>0:crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(plain.length,24);central.writeUInt16LE(filename.length,28)
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+filename.length,12);end.writeUInt32LE(30+filename.length+body.length,16)
 return Buffer.concat([local,filename,body,central,filename,end])
}
const page='https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-procedure-procedure-ptp-edits'
const url=part=>`https://www.cms.gov/files/zip/medicare-ncci-2026q4-practitioner-ptp-edits-ccipra-v323r0-f${part}.zip`
function edge(corrupt=false){
 const files=new Map(),requests=[]
 for(let part=1;part<=4;part++){
  const count=part===1?600:1,rows=Array.from({length:count},(_,n)=>`${String(10000+part*1000+n)}\t00530\t0\t20261001\t*\t1`)
  files.set(url(part),archive(`ccipra-v323r0-f${part}.txt`,'Column 1\tColumn 2\tPrior\tEffective\tDeletion\tModifier\r\n'+rows.join('\r\n')+'\r\n',corrupt&&part===4))
 }
 return {requests,handles:target=>target===page||files.has(target),outbound:async request=>{requests.push(request.url);if(request.url===page)return new Response([...files.keys()].map(u=>`<a href="${new URL(u).pathname}">synthetic-balm-1</a>`).join(''));assert.ok(files.has(request.url));return new Response(files.get(request.url))}}
}
const update={kind:'ptp',version:'32.3 r0',effectiveOn:'2026-10-01',licenseAcknowledged:true,licenseBasis:'synthetic-balm-1 reviewed test-only license',files:[1,2,3,4].map(part=>({url:url(part)})),batchLimit:2}

export async function codeImportJourney(){
 const provider=edge()
 await run(async h=>{
  await h.finishSetup()
  let result=await h.cmd('codes.update',update)
  assert.equal(result.status,'incomplete');assert.equal(result.rows,0)
  const key=result.id,unavailable=await h.cmd('codes.status',{})
  assert.equal(unavailable.find(s=>s.kind==='ptp').release,null)
  // A later request reopens durable database state, ignoring any client rows,
  // changed manifest or license supplied alongside its job identifier.
  result=await h.cmd('codes.update.continue',{resumeId:key,batchLimit:2,files:[],licenseBasis:'untrusted',rows:[{code:'99999'}]})
  assert.equal(result.status,'incomplete');assert.ok(result.rows>0)
  const before=result.rows
  const racing=await Promise.all([h.send('/api/balm/command',{name:'codes.update.continue',input:{resumeId:key,batchLimit:1}},h.owner),h.send('/api/balm/command',{name:'codes.update.continue',input:{resumeId:key,batchLimit:1}},h.owner)])
  assert.ok(racing.some(r=>r.status===200));assert.ok(racing.every(r=>[200,409].includes(r.status)))
  let loops=0
  do {result=await h.cmd('codes.update',{resumeId:key,batchLimit:2});assert.ok(++loops<20)}while(result.status==='incomplete')
  assert.equal(result.rows,603);assert.ok(result.rows>=before)
  const status=await h.cmd('codes.status',{}),release=status.find(s=>s.kind==='ptp').release
  assert.equal(release.id,key);assert.equal(release.row_count,603)
  const resumed=await h.cmd('codes.update.continue',{resumeId:key})
  assert.deepEqual(resumed,result,'a lost completion receipt can be read without downloading or writing again')
  const repeated=await h.cmd('codes.update',update)
  assert.equal(repeated.duplicate,true);assert.equal(repeated.id,key)
  // Cleanup and exact manifest retention are storage invariants supporting the
  // public completed receipt, not alternate ingestion doors.
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM bm_code_import_chunks WHERE release_id=?').bind(key).first()).n,0)
  const saved=await h.db.prepare('SELECT files FROM bm_code_releases WHERE id=?').bind(key).first()
  assert.equal(JSON.parse(saved.files).length,4);assert.ok(JSON.parse(saved.files).every(f=>/^[a-f0-9]{64}$/.test(f.sha256)))
 },{codeSets:false,codeSetEdge:provider,outbound:provider.outbound})
 const broken=edge(true)
 await run(async h=>{
  await h.finishSetup()
  let result=await h.cmd('codes.update',update),key=result.id,failed=false
  for(let n=0;n<20&&!failed;n++){
   const response=await h.send('/api/balm/command',{name:'codes.update.continue',input:{resumeId:key,batchLimit:2}},h.owner)
   if(response.status!==200){assert.match(response.text,/zip_member_checksum_mismatch/);failed=true}
   else assert.equal(response.value.result.status,'incomplete')
  }
  assert.equal(failed,true)
  assert.equal((await h.cmd('codes.status',{})).find(s=>s.kind==='ptp').release,null,'a late CRC error never publishes earlier saved parts')
 },{codeSets:false,codeSetEdge:broken,outbound:broken.outbound})
}

test('CODE-001: explicit durable continuation preserves cursors and publishes only after every archive checksum',codeImportJourney)
