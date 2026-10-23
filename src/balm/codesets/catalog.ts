import { audit, commit, day, guard, human, insist, now, one, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { kinds, normalizeCode, shownCode, type CodeKind } from './types'
export async function releaseAt(db:D1Database,kind:CodeKind,date:string) {
  return one(db,"SELECT id,kind,version,effective_on,next_due_on,source_page,sha256,row_count,completed_at FROM bm_code_releases WHERE kind=? AND status='ready' AND effective_on<=? ORDER BY effective_on DESC,completed_at DESC,id DESC LIMIT 1",kind,day(date,'date_of_service'))
}
export async function codeSetStatus(db:D1Database,today=new Date().toISOString().slice(0,10)) {
  return Promise.all(kinds.map(async kind=>{const release=await releaseAt(db,kind,today),incomplete=await rows(db,"SELECT id,version,effective_on,loaded_at FROM bm_code_releases WHERE kind=? AND status='loading' ORDER BY loaded_at DESC LIMIT 10",kind);return {kind,release,incomplete,missing:!release,stale:!release||release.next_due_on<=today,message:!release?`Load the ${kind} release for the date of service.`:release.next_due_on<=today?`${kind} ${release.version} is past its next scheduled release (${release.next_due_on}).`:null}}))
}
export async function searchCodes(db:D1Database,who:Actor,input:Data) {
  human(who)
  const kind=text(input.kind,'code_set',20) as CodeKind;insist(['icd10','hcpcs','cpt'].includes(kind),'choose_a_searchable_code_set')
  const date=day(input.date??new Date().toISOString().slice(0,10),'date_of_service'),release=await releaseAt(db,kind,date)
  insist(release,`Load ${kind} codes for ${date} before choosing a code.`,409)
  const query=text(input.query,'search_words_or_code',200).toLowerCase(),tokens=query.split(/\s+/).slice(0,12)
  const conditions=tokens.map(()=>`(lower(i.code) LIKE ? ESCAPE '\\' OR lower(i.description) LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM bm_code_synonyms s WHERE s.kind=? AND s.code=i.code AND s.term LIKE ? ESCAPE '\\'))`).join(' AND ')
  const escape=(s:string)=>s.replace(/[\\%_]/g,'\\$&')
  const args=tokens.flatMap(t=>{const term='%'+escape(t)+'%';return ['%'+escape(normalizeCode(t).toLowerCase())+'%',term,kind,term]})
  const found=await rows(db,`SELECT i.code,i.description,i.billable,i.timed FROM bm_code_items i WHERE i.release_id=? AND i.effective_on<=? AND (i.deleted_on IS NULL OR i.deleted_on>?) AND ${conditions} ORDER BY i.code LIMIT 50`,release.id,date,date,...args)
  return {kind,date,version:release.version,releaseId:release.id,source:release.source_page,results:found.map(r=>({...r,code:kind==='icd10'?shownCode(r.code):r.code}))}
}
export async function billableDiagnosis(db:D1Database,value:unknown,date:string) {
  const code=normalizeCode(value),release=await releaseAt(db,'icd10',date)
  if(!release)return {valid:false,code,reason:`Load ICD-10-CM for ${date}.`,children:[],release:null}
  const item=await one(db,'SELECT code,description,billable FROM bm_code_items WHERE release_id=? AND code=?',release.id,code)
  const children=item&&!item.billable?await rows(db,"SELECT code,description FROM bm_code_items WHERE release_id=? AND billable=1 AND code LIKE ? ORDER BY code LIMIT 100",release.id,code+'%'):[]
  return {valid:!!item?.billable,code:shownCode(code),reason:!item?`${shownCode(code)} is absent from ICD-10-CM ${release.version}.`:!item.billable?`${shownCode(code)} is a header in ICD-10-CM ${release.version}; choose a billable child.`:null,children:children.map(c=>({...c,code:shownCode(c.code)})),release}
}
export async function saveSynonym(db:D1Database,who:Actor,input:Data) {
  human(who);insist(who.role==='owner','only_owner_sets_code_synonyms',403)
  const kind=text(input.kind,'code_set',20);insist(['icd10','hcpcs','cpt'].includes(kind),'unknown_synonym_code_set')
  const code=normalizeCode(text(input.code,'code',10)),term=text(input.term,'synonym',200).toLowerCase()
  await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_code_items i JOIN bm_code_releases r ON r.id=i.release_id WHERE r.kind=? AND r.status=\'ready\' AND i.code=?)',kind,code),stmt(db,'INSERT INTO bm_code_synonyms(kind,code,term,created_by,created_at) VALUES(?,?,?,?,?) ON CONFLICT(kind,code,term) DO NOTHING',kind,code,term,who.email,now()),audit(db,who,'codes.synonym_saved',null,null,kind)])
  return {kind,code,term}
}
