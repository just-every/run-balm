import { audit, commit, guard, id, insist, now, one, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { biller } from '../domain/role-access'
import { clientGuard } from './access'
import { parseX12, type Segment } from './x12'

const transactionCodes:Record<string,string>={A:'Accepted',E:'Accepted with errors noted',R:'Rejected',M:'Rejected: message authentication failed',W:'Rejected: assurance validity failed',X:'Rejected: content could not be analyzed after decryption'}
const groupCodes:Record<string,string>={...transactionCodes,P:'Partially accepted'}
const syntaxCodes:Record<string,string>={'1':'Unrecognized segment','2':'Unexpected segment','3':'Mandatory segment missing','4':'Loop occurs too many times','5':'Segment exceeds maximum use','6':'Segment not in the transaction set','7':'Segment not in proper sequence','8':'Segment has data element errors','I6':'Implementation dependent segment missing','I7':'Implementation loop occurs below minimum','I8':'Implementation segment occurs below minimum','I9':'Implementation dependent segment not used'}
const elementCodes:Record<string,string>={'1':'Mandatory data element missing','2':'Conditional required data element missing','3':'Too many data elements','4':'Data element too short','5':'Data element too long','6':'Invalid character in data element','7':'Invalid code value','8':'Invalid date','9':'Invalid time','10':'Exclusion condition violated','12':'Too many repetitions','13':'Too many components','I10':'Implementation not used data element present','I11':'Implementation too few repetitions','I12':'Implementation pattern match failure','I13':'Implementation dependent data element missing'}
function reason(s:Segment) {
 const code=s[0]==='IK3'?s[4]:s[0]==='IK4'?s[3]:s[1]
 const description=(s[0]==='IK3'?syntaxCodes:s[0]==='IK4'?elementCodes:s[0]==='IK5'?transactionCodes:groupCodes)[code]??'Unmapped source code; review the original 999'
 return {segment:s[0],code,description,source:s.join(' · ')}
}

export async function functionalBatchOwnerOnly(db:D1Database,batchId:string) {
 return !!await one(db,"SELECT 1 FROM bm_claim_batch_items b JOIN bm_claims c ON c.id=b.claim_id WHERE b.batch_id=? AND json_extract(c.snapshot,'$.injury') IS NOT NULL",batchId)
}

export async function functionalBatchClaims(db:D1Database,who:Actor,batchId:string) {
 insist(who.role==='owner'||biller(who),'functional_acknowledgments_require_biller_or_owner',403)
 insist(who.role==='owner'||!await functionalBatchOwnerOnly(db,batchId),'injury_case_requires_owner',403)
 const claims=await rows(db,'SELECT c.id,c.client_id,p.erased_at FROM bm_claim_batch_items b JOIN bm_claims c ON c.id=b.claim_id JOIN bm_clients p ON p.id=c.client_id WHERE b.batch_id=?',batchId)
 insist(claims.length>0&&claims.every(c=>!c.erased_at),'functional_acknowledgment_batch_unavailable',409)
 return claims
}
export const functionalGuards=(db:D1Database,who:Actor,claims:Data[])=>claims.flatMap(c=>[clientGuard(db,who,c.client_id),guard(db,"EXISTS(SELECT 1 FROM bm_claims WHERE id=? AND (?='owner' OR json_extract(snapshot,'$.injury') IS NULL))",c.id,who.role)])

/** A 999 describes syntax of one stored 837 transaction, never payer adjudication. */
export async function importFunctionalAcknowledgment(db:D1Database,who:Actor,input:Data) {
 const batchId=text(input.batchId,'batch',100),batch=await one(db,'SELECT * FROM bm_claim_batches WHERE id=?',batchId)
 insist(batch?.body,'insurance_batch_not_found',404)
 insist(typeof input.x12==='string'&&!/[^\x09\x0a\x0d\x20-\x7e]/.test(input.x12),'999_requires_ascii_original')
 const claims=await functionalBatchClaims(db,who,batchId),sent=parseX12(batch.body,'837'),parsed=parseX12(input.x12,'999')
 insist(sent.envelope&&parsed.envelope,'functional_acknowledgment_envelope_required')
 const {isa,gs,st}=parsed.envelope,original=sent.envelope
 insist(isa[5]===original.isa[7]&&isa[7]===original.isa[5]&&isa[6].trim()===original.isa[8].trim()&&isa[8].trim()===original.isa[6].trim()&&gs[2]===original.gs[3]&&gs[3]===original.gs[2],'functional_acknowledgment_parties_do_not_match')
 insist(isa[12]==='00501'&&/^\d{9}$/.test(isa[13])&&/^\d{1,9}$/.test(gs[6])&&/^[A-Z0-9]{4,9}$/.test(st[2]),'invalid_999_envelope_control_format')
 insist(isa[15]===original.isa[15],'functional_acknowledgment_environment_does_not_match')
 insist(gs[1]==='FA'&&gs[8]==='005010X231A1'&&st[3]==='005010X231A1','unsupported_999_implementation')
 const segments=parsed.segments,ak1=segments.filter(s=>s[0]==='AK1'),ak2=segments.filter(s=>s[0]==='AK2'),ik5=segments.filter(s=>s[0]==='IK5'),ak9=segments.filter(s=>s[0]==='AK9')
 insist(ak1.length===1&&ak9.length===1&&ak2.length<=1&&ik5.length===ak2.length,'999_requires_one_group_and_transaction_result')
 insist(ak1[0][1]===original.gs[1]&&ak1[0][2]===original.gs[6]&&(!ak1[0][3]||ak1[0][3]===original.gs[8]),'999_group_does_not_match_batch')
 const group=ak9[0][1]
 insist(group in groupCodes,'unsupported_999_acknowledgment_code')
 let transaction=group
 if(ak2.length) {
  insist(ak2[0][1]===original.st[1]&&ak2[0][2]===original.st[2]&&(!ak2[0][3]||ak2[0][3]===original.st[3]),'999_transaction_does_not_match_batch')
  const a=segments.indexOf(ak2[0]),k=segments.indexOf(ik5[0]),g=segments.indexOf(ak9[0])
  insist(segments[0]===ak1[0]&&a===1&&k>a&&g===segments.length-1&&g===k+1&&segments.slice(a+1,k).every(s=>['IK3','IK4','CTX'].includes(s[0])),'invalid_999_segment_order')
  transaction=ik5[0][1]
  insist(transaction in transactionCodes,'unsupported_999_acknowledgment_code')
 } else {
  // AK2 is optional. A group summary binds the single stored transaction by
  // AK1 and the exact included, received and accepted counts in AK9.
  insist(segments.length===2&&segments[0]===ak1[0]&&segments[1]===ak9[0],'invalid_999_segment_order')
 }
 const accepted=['A','E'].includes(transaction)
 insist(ak9[0][2]==='1'&&ak9[0][3]==='1'&&ak9[0][4]===(accepted?'1':'0')&&(['A','E'].includes(group)===accepted)&&group!=='P','invalid_999_group_counts')
 const syntaxStatus=accepted?(transaction==='E'||group==='E'?'accepted_with_errors':'accepted'):'rejected'
 // Keep original bytes, including line endings and surrounding whitespace, separately from parsing.
 const body=input.x12 as string,hash=await sha256(body),reasons=segments.filter(s=>['IK3','IK4','IK5','AK9'].includes(s[0])).map(reason)
 const duplicateResult=async()=>{
  const existing=await one(db,'SELECT id,sha256,syntax_status FROM bm_functional_acknowledgments WHERE sha256=? OR (batch_id=? AND interchange_control=? AND group_control=? AND transaction_control=?)',hash,batchId,isa[13],gs[6],st[2])
  if(!existing)return null
  insist(existing.sha256===hash,'999_control_reused_with_different_original',409)
  await commit(db,who,[...functionalGuards(db,who,claims),guard(db,'EXISTS(SELECT 1 FROM bm_claim_batches WHERE id=? AND sha256=? AND body<>\'\')',batchId,batch.sha256),...claims.map(c=>audit(db,who,'insurance.999_replayed',c.client_id,existing.id))])
  return {id:existing.id,batchId,syntaxStatus:existing.syntax_status,duplicate:true}
 }
 const duplicate=await duplicateResult();if(duplicate)return duplicate
 const key=id(),at=now()
 try {
  await commit(db,who,[...functionalGuards(db,who,claims),guard(db,'EXISTS(SELECT 1 FROM bm_claim_batches WHERE id=? AND sha256=? AND body<>\'\')',batchId,batch.sha256),
   stmt(db,'INSERT INTO bm_functional_acknowledgments(id,batch_id,body,sha256,interchange_control,group_control,transaction_control,syntax_status,reasons,imported_by,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',key,batchId,body,hash,isa[13],gs[6],st[2],syntaxStatus,JSON.stringify(reasons),who.email,at),
   ...claims.map(c=>audit(db,who,'insurance.999_imported',c.client_id,key))])
 } catch(error) {const replay=await duplicateResult();if(replay)return replay;throw error}
 return {id:key,batchId,syntaxStatus,duplicate:false}
}
