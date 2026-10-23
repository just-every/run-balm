import { audit, commit, guard, human, id, insist, now, one, rows, sha256, stmt, type Actor, type Data } from '../domain/model'
import { zipMembers } from './archive'
import { hcpcs, icdOrder, licensedCpt, mue, ptp, type CptMapping } from './parsers'
import { oneText } from './records'
import { releaseSpec, verifyCmsListing } from './sources'
import type { CodeRow, ReleaseSpec } from './types'
const hashBytes=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))].map(b=>b.toString(16).padStart(2,'0')).join('')
const owner=(who:Actor)=>{human(who);insist(who.role==='owner','only_the_owner_updates_code_sets',403)}
const validMember=(kind:string,name:string)=>kind==='icd10'?/icd10cm_order_\d{4}\.txt$/i.test(name):kind==='hcpcs'?/ANWEB[^/]*\.txt$/i.test(name):kind==='ptp'?/ccipra[^/]*\.txt$/i.test(name):/PractitionerServices[^/]*\.csv$/i.test(name)

/** HTTPS fetches the exact CMS linked bytes. Parsing and inserts are bounded;
 * only the final publication batch makes the release eligible for claims. */
export async function updateCodes(db:D1Database,who:Actor,input:Data,fetcher:typeof fetch=fetch) {
  owner(who)
  const spec=releaseSpec(input)
  insist(spec.kind!=='cpt','upload_your_deployments_licensed_cpt_file')
  await verifyCmsListing(spec,fetcher)
  // A release manifest binds every archive hash; download and import one archive
  // at a time, so four large PTP parts never coexist in memory.
  const installed=await rows(db,"SELECT id,files,row_count,sha256 FROM bm_code_releases WHERE kind=? AND effective_on=? AND status='ready' ORDER BY completed_at DESC",spec.kind,spec.effectiveOn)
  if(installed.length){
    const observed=[]
    for(const file of spec.files){const response=await fetcher(file.url,{redirect:'error'});insist(response.ok,'cms_release_download_failed',424);const bytes=new Uint8Array(await response.arrayBuffer());insist(bytes.length<=64_000_000,'cms_archive_too_large_for_this_update',413);const digest=await hashBytes(bytes);insist(!file.sha256||file.sha256===digest,'cms_file_digest_does_not_match_release_not_published',409);observed.push({url:file.url,sha256:digest})}
    const digest=await sha256(JSON.stringify(observed)),same=installed.find(r=>r.sha256===digest)
    if(same)return {id:same.id,duplicate:true,changed:false,rows:same.row_count}
  }
  const key=id(),at=now()
  await commit(db,who,[stmt(db,"INSERT INTO bm_code_releases(id,kind,version,effective_on,next_due_on,source_page,files,sha256,status,license_basis,loaded_by,loaded_at) VALUES(?,?,?,?,?,?,?,?,'loading',?,?,?)",key,spec.kind,spec.version,spec.effectiveOn,spec.nextDueOn,spec.sourcePage,'[]','pending:'+key,spec.licenseBasis,who.email,at)])
  const hashes:{url:string;sha256:string}[]=[],counts={rows:0}
  try {
    for(const file of spec.files){
      const response=await fetcher(file.url,{redirect:'error'});insist(response.ok,'cms_release_download_failed',424)
      insist(Number(response.headers.get('content-length')??0)<=64_000_000,'cms_archive_too_large_for_this_update',413)
      const bytes=new Uint8Array(await response.arrayBuffer());insist(bytes.length<=64_000_000,'cms_archive_too_large_for_this_update',413)
      const digest=await hashBytes(bytes);insist(!file.sha256||file.sha256===digest,'cms_file_digest_does_not_match_release_not_published',409)
      hashes.push({url:file.url,sha256:digest})
      const members=zipMembers(bytes).filter(m=>validMember(spec.kind,m.name));insist(members.length===1,'cms_archive_does_not_contain_one_expected_complete_data_file')
      const parser=spec.kind==='icd10'?icdOrder:spec.kind==='hcpcs'?hcpcs:spec.kind==='ptp'?ptp:mue
      await insertRows(db,who,key,parser(members[0].chunks(),spec),counts)
    }
    return await publish(db,who,key,spec,hashes,counts.rows)
  }catch(error){
    // An interrupted release stays visibly incomplete and cannot affect billing.
    await commit(db,who,[audit(db,who,'codes.update_incomplete',null,key,spec.kind)])
    throw error
  }
}

export async function importLicensedCpt(db:D1Database,who:Actor,input:Data) {
  owner(who)
  const spec=releaseSpec({...input,kind:'cpt'}),content=String(input.content??'')
  insist(content.length>0&&content.length<=20_000_000,'choose_your_licensed_cpt_data_file')
  const digest=await sha256(content),duplicate=await one(db,"SELECT id,row_count FROM bm_code_releases WHERE kind='cpt' AND effective_on=? AND sha256=? AND status='ready'",spec.effectiveOn,digest)
  if(duplicate)return {id:duplicate.id,duplicate:true,changed:false,rows:duplicate.row_count}
  const key=id(),counts={rows:0}
  await commit(db,who,[stmt(db,"INSERT INTO bm_code_releases(id,kind,version,effective_on,next_due_on,source_page,files,sha256,status,license_basis,loaded_by,loaded_at) VALUES(?,'cpt',?,?,?,?,?,?,'loading',?,?,?)",key,spec.version,spec.effectiveOn,spec.nextDueOn,spec.sourcePage,'[]','pending:'+key,spec.licenseBasis,who.email,now())])
  await insertRows(db,who,key,licensedCpt(oneText(content),spec,input.mapping as CptMapping),counts)
  return publish(db,who,key,spec,[{url:'deployment-licensed-file',sha256:digest}],counts.rows,digest)
}

async function insertRows(db:D1Database,who:Actor,key:string,items:AsyncIterable<CodeRow>,count:{rows:number}) {
  let chunk:CodeRow[]=[]
  const save=async()=>{
    if(!chunk.length)return
    await commit(db,who,[guard(db,"EXISTS(SELECT 1 FROM bm_code_releases WHERE id=? AND status='loading' AND loaded_by=?)",key,who.email),stmt(db,`INSERT INTO bm_code_items(release_id,item_key,code,description,billable,code2,effective_on,deleted_on,modifier,max_units,adjudication,timed,payload)
      SELECT ?,json_extract(value,'$.key'),json_extract(value,'$.code'),json_extract(value,'$.description'),json_extract(value,'$.billable'),json_extract(value,'$.code2'),json_extract(value,'$.effectiveOn'),json_extract(value,'$.deletedOn'),json_extract(value,'$.modifier'),json_extract(value,'$.maxUnits'),json_extract(value,'$.adjudication'),json_extract(value,'$.timed'),value FROM json_each(?)`,key,JSON.stringify(chunk))])
    count.rows+=chunk.length;chunk=[]
  }
  for await(const row of items){chunk.push(row);if(chunk.length===500)await save()}
  await save()
}
async function publish(db:D1Database,who:Actor,key:string,spec:ReleaseSpec,files:{url:string;sha256:string}[],count:number,contentHash?:string) {
  insist(count>0,'code_release_contains_no_rows')
  const digest=contentHash??await sha256(JSON.stringify(files)),duplicate=await one(db,"SELECT id,row_count FROM bm_code_releases WHERE kind=? AND effective_on=? AND sha256=? AND status='ready'",spec.kind,spec.effectiveOn,digest)
  if(duplicate)return {id:duplicate.id,duplicate:true,changed:false,rows:duplicate.row_count,incompleteAttempt:key}
  const prior=await one(db,"SELECT id FROM bm_code_releases WHERE kind=? AND status='ready' AND effective_on<=? ORDER BY effective_on DESC,completed_at DESC,id DESC LIMIT 1",spec.kind,spec.effectiveOn)
  const comparable=(name:string)=>spec.kind==='ptp'?`${name}.payload`:`json_remove(${name}.payload,'$.effectiveOn')`
  const difference=await one(db,`SELECT
    (SELECT COUNT(*) FROM bm_code_items n WHERE n.release_id=? AND NOT EXISTS(SELECT 1 FROM bm_code_items p WHERE p.release_id=? AND p.item_key=n.item_key)) AS added,
    (SELECT COUNT(*) FROM bm_code_items p WHERE p.release_id=? AND NOT EXISTS(SELECT 1 FROM bm_code_items n WHERE n.release_id=? AND n.item_key=p.item_key)) AS removed,
    (SELECT COUNT(*) FROM bm_code_items n JOIN bm_code_items p ON p.release_id=? AND p.item_key=n.item_key WHERE n.release_id=? AND ${comparable('n')}<>${comparable('p')}) AS changed`,key,prior?.id??'',prior?.id??'',key,prior?.id??'',key)
  await commit(db,who,[guard(db,'(SELECT COUNT(*) FROM bm_code_items WHERE release_id=?)=?',key,count),stmt(db,"UPDATE bm_code_releases SET status='ready',files=?,sha256=?,row_count=?,completed_at=? WHERE id=? AND status='loading'",JSON.stringify(files),digest,count,now(),key),guard(db,'changes()=1'),audit(db,who,'codes.release_loaded',null,key,`${spec.kind} ${spec.version}; ${count} rows` )])
  return {id:key,duplicate:false,changed:true,rows:count,changes:difference}
}
