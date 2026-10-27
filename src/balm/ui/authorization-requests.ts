import {check,empty,field,form,h,hidden,owner,panel,select,stamp,status,textarea,usDate,zoneOf} from './shared'
import {authorizationForm} from './insurance-policy'

export function authorizationRequestHistory(s:any,list:any[]|null){
 return (list??[]).map(r=>`<article id="authorization-request-${h(r.id)}"><h3>${status(r.status)} · Prior authorization request</h3><p>Prepared ${stamp(s,r.prepared_at)} by ${h(r.prepared_by)}<br>Referral <a href="/app/cases#case-${h(r.referral_id)}">${h(r.referral_id)}</a></p>${r.submitted_on?`<p>Submission recorded: ${h(usDate(r.submitted_on,zoneOf(s)))} via ${r.channel==='availity'?'Availity':'payer portal'} · ${h(r.submission_reference)} · ${h(r.submitted_by)}</p>`:''}${r.decision?`<p>Decision recorded: ${h(r.decision)} ${h(usDate(r.decided_on,zoneOf(s)))} · ${h(r.decision_reference)} · ${h(r.decided_by)}<br>${h(r.reason)}</p>${r.authorization_id?`<a href="/app/clients/${h(r.client_id)}#authorization-${h(r.authorization_id)}">Open authorization created from this decision</a>`:''}`:''}</article>`).join('')
}
export function authorizationRequestsPanel(s:any,f:any){
 const list=f.insurance?.authorizationRequests
 if(!list)return ''
 const path='/app/clients/'+f.client.id
 const choices=f.insurance.authorizationPreparation??[]
 const prepare=`<details><summary>Prepare a prior authorization request</summary><p>Choose the referral, its signed evaluation and the plan signed by the same therapist. Outcome scores must already be recorded in that evaluation. The owner reviews the fixed packet and approves its release before a biller downloads it. Submission takes place outside Balm.</p>${form('insurance.authorization_request.prepare',path,
 select('referralId','Referral',(f.referrals??[]).filter((r:any)=>r.policy_id).map((r:any)=>[r.id,usDate(r.received_on,zoneOf(s))+' · '+r.referring_first+' '+r.referring_last]))+
 select('noteId','Signed evaluation',[...new Map(choices.map((c:any)=>[c.note_id,c])).values()].map((c:any)=>[c.note_id,'Signed '+stamp(s,c.signed_at)]))+
 select('planId','Signed plan of care',choices.map((c:any)=>[c.plan_id,'Signed '+stamp(s,c.plan_signed_at)])),'Prepare authorization packet')}</details>`
 const records=list.map((r:any)=>{
  const ids=hidden('id',r.id)+hidden('sha256',r.sha256)
  const original=owner(s)?`<p><a href="/api/balm/insurance/authorization-request/${h(r.id)}">Download fixed authorization packet</a></p>`:''
  const submission=r.status==='prepared'?`<details><summary>Record external submission</summary>${form('insurance.authorization_request.submit',path,ids+select('channel','Submitted through',[['availity','Availity'],['payer_portal','Payer portal']])+field('submittedOn','Submitted on','','date','required')+field('reference','Portal submission reference','','text','required maxlength="160"')+check('attest','I submitted this exact packet outside Balm.'),'Record submission')}</details>`:''
  const decision=r.status==='submitted'?`<details><summary>Record payer approval</summary><p>Copy the payer’s actual approved allowance and dates. This creates its authorization; Balm does not send a request or infer approval.</p>${authorizationForm(s,r.policy_id,path,undefined,'',ids+hidden('decision','approved')+field('decidedOn','Decision date','','date','required')+field('reference','Payer decision reference','','text','required maxlength="160"')+textarea('reason','Decision source and terms','','required maxlength="1000"')+check('attest','I checked this approval against the payer’s decision.'),'insurance.authorization_request.decide','Record approval and create authorization')}</details><details><summary>Record payer denial</summary>${form('insurance.authorization_request.decide',path,ids+hidden('decision','denied')+field('decidedOn','Decision date','','date','required')+field('reference','Payer decision reference','','text','required maxlength="160"')+textarea('reason','Denial reason and source','','required maxlength="1000"')+check('attest','I checked this denial against the payer’s decision.'),'Record denial')}</details>`:''
  return authorizationRequestHistory(s,[r])+original+submission+decision
 }).join('')
 return panel('Prior authorization requests','<p>Prepare signed records, then record work completed in Availity or the payer’s portal. Balm does not submit these requests or retrieve decisions.</p>'+prepare+(records||empty('No prior authorization requests yet.')),'','authorization-requests')
}
