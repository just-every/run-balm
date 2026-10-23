import {field,form,h,hidden,panel,select,stamp,textarea} from './shared'
import {patientForm} from './portal-content'

export function guardianPatientPanel(d:any){
 if(!d.guardianChildren?.length)return ''
 return `<section class="card portal-section" id="children"><h2>Your children's portals</h2><p>Currently viewing ${h(d.patient.firstName)} ${h(d.patient.lastName)}. Choose a child to open only that child's records.</p>${patientForm('guardian.select',select('id','Child',d.guardianChildren.map((c:any)=>[c.id,c.first_name+' '+c.last_name]),d.clientId),'Open child portal')}</section>`
}
export function patientProfilePanel(d:any){
 const profile=d.profile
 if(!profile)return ''
 const confirm='<label class="check"><input type="checkbox" name="confirm" required><span>I confirm these details are correct and ask the clinic to review this update.</span></label>'
 return `<section class="card portal-section" id="profile"><h2>Contact and insurance updates</h2><p>Send updated details to your clinic. Staff verify changes before replacing your sign-in contact or active insurance. Your current sign-in stays in place until then.</p><details><summary>Update contact details</summary>${patientForm('profile.contact',field('email','New email address',profile.contact.email??'','email')+field('phone','New phone number',profile.contact.phone??'','tel')+confirm,'Send contact update')}</details><details><summary>Update insurance details</summary>${patientForm('profile.insurance',field('payer','Insurance payer','','text','required maxlength="150"')+field('memberId','Member ID','','text','required maxlength="100"')+field('group','Group number','','text','maxlength="100"')+field('subscriber','Subscriber name','','text','required maxlength="150"')+select('relationship','Relationship to subscriber',[['self','Self'],['spouse','Spouse'],['child','Child'],['other','Other']])+confirm,'Send insurance update')}</details>${profile.changes.map((r:any)=>`<article><h3>${r.kind==='contact'?'Contact':'Insurance'} update</h3><p>Submitted ${h(r.submitted_at.slice(0,10))} · ${r.reviewed_at?'Applied by the clinic':'Awaiting clinic verification'}</p><dl>${Object.entries(r.payload).map(([key,value])=>`<dt>${h(key)}</dt><dd>${h(value??'Not supplied')}</dd>`).join('')}</dl></article>`).join('')}</section>`
}
export function guardianStaffPanel(s:any,f:any){
 if(!f.guardianGrants)return ''
 const path='/app/clients/'+f.client.id
 const grants=f.guardianGrants.map((g:any)=>`<article class="entry"><h3>${h(g.name)}</h3><p>${h(g.relationship)} · ${h(g.email)} · ${g.revoked_at?'Revoked':`Granted ${stamp(s,g.granted_at)}`}</p>${g.revoked_at?'':form('guardian.revoke',path,hidden('id',g.id),'Revoke guardian access',true)}</article>`).join('')
 const fields=hidden('clientId',f.client.id)+field('name','Guardian full name','','text','required maxlength="160"')+field('email','Guardian email address','','email','required')+select('relationship','Relationship',[['parent','Parent'],['guardian','Legal guardian']])+textarea('verification','Authority verification and confidential-care restrictions reviewed','','required maxlength="1000"')+'<label class="check"><input type="checkbox" name="verified" required><span>I verified this person’s authority for this minor and reviewed confidential-care restrictions. I authorize access to the child’s portal.</span></label>'
 return panel('Guardian access',`<p>Only the owner grants access after verifying authority for each minor. Shared email or intake signatures never grant access. Delegation stops at age 18 and must be revoked if authority changes.</p>${grants||'<p>No guardian access granted.</p>'}<details><summary>Grant verified guardian access</summary>${form('guardian.grant',path,fields,'Grant guardian access')}</details>`,'full')
}
export function profileStaffPanel(s:any,f:any){
 if(!f.portalProfileChanges?.length)return ''
 const path='/app/clients/'+f.client.id
 const records=f.portalProfileChanges.map((r:any)=>{
  const payload=`<dl>${Object.entries(r.payload).map(([k,v])=>`<dt>${h(k)}</dt><dd>${h(v??'Not supplied')}</dd>`).join('')}</dl>`
  if(r.reviewed_at)return `<article class="entry"><h3>${h(r.kind)} update · applied ${stamp(s,r.reviewed_at)}</h3>${payload}</article>`
  const policyFields=r.kind==='insurance'?select('policyId','Coverage record',[['','Add a new policy'],...(f.insurance?.policies??[]).map((p:any)=>[p.id,p.payer_name+' · '+p.member_id])])+select('payerId','Verified payer',(s.insurance?.payers??[]).map((p:any)=>[p.id,p.name]))+select('relationship','Verified subscriber relationship',[['18','Self'],['01','Spouse'],['19','Child']])+select('patientSex','Patient sex for the claim',[['F','Female'],['M','Male'],['U','Unknown']])+field('subscriberFirst','Subscriber first name','','text')+field('subscriberLast','Subscriber last name','','text')+field('subscriberDob','Subscriber date of birth','','date')+select('subscriberSex','Subscriber sex',[['F','Female'],['M','Male'],['U','Unknown']])+field('address','Verified address','','text','required')+field('city','City','','text','required')+field('state','State','','text','required maxlength="2"')+field('postalCode','ZIP','','text','required')+field('startsOn','Coverage starts','','date','required')+field('priority','Payer priority',1,'number','min="1" max="3" required'):''
  const review=s.actor.role==='owner'?form('profile.review',path,hidden('id',r.id)+hidden('sha256',r.sha256)+policyFields+'<label class="check"><input type="checkbox" name="verified" required><span>I verified the patient identity and these updated details, including the new contact address or complete coverage record.</span></label>','Apply verified update'):'<p>The owner verifies and applies this update.</p>'
  return `<article class="entry"><h3>${h(r.kind)} update · ${stamp(s,r.submitted_at)}</h3>${payload}<details><summary>Verify and apply patient update</summary>${review}</details></article>`
 }).join('')
 return panel('Patient-submitted updates','<p>Applying a verified contact change signs the patient and their guardians out. A changed patient version requires a fresh submission. Coverage changes reset eligibility; they never send a claim or overwrite an issued invoice.</p>'+records,'full')
}
