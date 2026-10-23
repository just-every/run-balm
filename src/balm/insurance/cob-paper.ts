import { audit, commit, guard, id, insist, now, one, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { attachment, attachmentResponse } from '../messages/attachments'
import { claimFor, insuranceActor, yes } from './access'
import { biller } from '../domain/role-access'
import { payerAuthority } from './manual-payers'
import { cms1500 } from './cms1500'
import type { ClaimSnapshot } from './types'
import { scrubClaim } from './scrub'
import { refreshClaimFacts } from './claims'
import { claimFactGuards } from './fences'

export async function preparePaper(db:D1Database,who:Actor,input:Data) {
 const claim=await claimFor(db,who,input.claimId),facts=JSON.parse(claim.snapshot) as ClaimSnapshot
 insist(facts.cob&&claim.status==='ready','paper_COB_needs_ready_secondary_or_tertiary_claim',409)
 insist(JSON.stringify(await refreshClaimFacts(db,who,claim))===JSON.stringify(facts)&&!scrubClaim(facts).length,'refresh_and_review_claim_before_printing',409)
 const eob=await attachment(input);insist(eob&&yes(input.attest),'attach_primary_EOB_and_confirm_it_matches_this_patient')
 const key=id(),body=cms1500(facts,claim.id),hash=await sha256(body),at=now()
 await commit(db,who,[payerAuthority(db,who),...claimFactGuards(db,claim,facts),stmt(db,'INSERT INTO bm_cob_paper_packets(id,claim_id,body,sha256,eob_base64,eob_mime,eob_sha256,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',key,claim.id,body,hash,eob.content,eob.mime,eob.digest,who.email,at),audit(db,who,'insurance.paper_prepared',claim.client_id,claim.id)])
 return {id:key,status:'prepared_not_sent',sha256:hash}
}
export async function submitPaper(db:D1Database,who:Actor,input:Data) {
 const packet=await one(db,'SELECT * FROM bm_cob_paper_packets WHERE id=?',text(input.id,'paper_packet',100));insist(packet,'paper_packet_not_found',404)
 const claim=await claimFor(db,who,packet.claim_id),reference=text(input.reference,'mail_or_payer_receipt_reference',150),at=now()
 insist(yes(input.attest)&&!packet.submitted_at&&claim.status==='ready','confirm_actual_submission_of_unsigned_paper_packet',409)
 await commit(db,who,[payerAuthority(db,who),stmt(db,'UPDATE bm_cob_paper_packets SET submitted_at=?,submitted_by=?,reference=? WHERE id=? AND submitted_at IS NULL',at,who.email,reference,packet.id),guard(db,'changes()=1'),stmt(db,"UPDATE bm_claims SET status='submitted',updated_at=?,version=version+1 WHERE id=? AND status='ready' AND version=?",at,claim.id,claim.version),guard(db,'changes()=1'),stmt(db,"UPDATE bm_cob_stages SET state='sent',updated_at=?,version=version+1 WHERE invoice_id=? AND policy_id=? AND state='unsent'",at,claim.invoice_id,claim.policy_id),guard(db,'changes()=1'),stmt(db,'INSERT INTO bm_claim_events(id,claim_id,kind,detail,created_at) VALUES(?,?,?,?,?)',id(),claim.id,'paper_submitted',JSON.stringify({packetId:packet.id,reference}),at),audit(db,who,'insurance.paper_submitted',claim.client_id,claim.id)])
 return {id:packet.id,status:'submitted',reference}
}
export async function cobPaperDownload(db:D1Database,initial:Actor,key:string,eob=false) {
 const who=await insuranceActor(db,initial,true);insist(who.role==='owner'||biller(who),'COB_requires_biller_or_owner',403)
 const packet=await one(db,'SELECT * FROM bm_cob_paper_packets WHERE id=?',key);insist(packet,'paper_packet_not_found',404)
 const claim=await claimFor(db,who,packet.claim_id)
 await commit(db,who,[payerAuthority(db,who),audit(db,who,eob?'insurance.paper_EOB_downloaded':'insurance.paper_downloaded',claim.client_id,claim.id)])
 if(eob)return attachmentResponse({filename:'primary-eob'+(packet.eob_mime==='application/pdf'?'.pdf':'.image'),mime:packet.eob_mime,content:packet.eob_base64,digest:packet.eob_sha256})
 return new Response(packet.body,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'",'x-content-type-options':'nosniff','content-disposition':'inline; filename="CMS1500.html"','etag':'"'+packet.sha256+'"'}})
}
