import { hostDateAt } from '../availability/timezone'
import type { Data } from '../domain/model'

/** Reuse the file's existing scoped reads; search grants no additional record access. */
export function existingHistory(file: Data, zone: string): Data[] {
  const path='/app/clients/'+file.client.id, records:Data[]=[], date=(at:string)=>hostDateAt(new Date(at),zone)
  for(const n of file.notes??[])records.push({id:n.id,title:n.title,type:'note',date:date(n.createdAt),
    text:[n.title,...n.revisions.map((r:Data)=>r.body),...n.addenda.map((a:Data)=>a.body)].join('\n'),url:path+'#note-'+n.id,action:'Open note',audit:'note.read'})
  for(const r of file.intake??[])records.push({id:r.id,title:r.formTitle,type:'intake',date:date(r.submittedAt),
    text:JSON.stringify([r.formTitle,r.questions,r.answers]),url:path+'#intake-'+r.id,action:'Open intake',audit:'intake.read'})
  for(const p of file.plans??[])if(p.content)records.push({id:p.id,title:'Plan of care',type:'plan',date:date(p.createdAt),
    text:JSON.stringify(p.content),url:path+'#plan-'+p.id,action:'Open plan',audit:'plan.read'})
  for(const c of file.intakeDocuments?.consents??[])records.push({id:c.id,title:c.policy_title,type:'consent',date:date(c.signed_at),
    text:[c.policy_title,c.policy_kind,c.signer_name].join('\n'),url:'/app/intake/consents/'+c.id+'.pdf',action:'Download signed consent',audit:'consent.read'})
  for(const card of file.intakeDocuments?.insurance??[])for(const side of ['front','back'])if(card['has_'+side])records.push({id:card.id+'-'+side,title:card.payer+' insurance card ('+side+')',type:'insurance_card',date:date(card.received_at),
    text:[card.payer,card.member_id,card.group_number,card.subscriber_name].join('\n'),url:'/app/intake/insurance/'+card.id+'/'+side,action:'Open card image',audit:'insurance.read'})
  for(const identity of file.intakeDocuments?.identities??[])records.push({id:identity.id,title:'Photo ID',type:'identity',date:date(identity.received_at),text:'Photo ID',
    url:'/app/intake/identity/'+identity.id+'/photo',action:'Open photo ID',audit:'identity.read'})
  for(const n of file.imported?.notes??[])records.push({id:n.id,title:n.title,type:'historical_note',date:n.source_date?.slice(0,10)??'',text:[n.title,n.body,n.provider].join('\n'),
    url:path+'#historical-'+n.id,action:'Open historical note',audit:'movein.note_read'})
  for(const m of file.messages?.messages??[]){
    records.push({id:m.id,title:'Secure message',type:'message',date:date(m.sentAt),text:m.body,url:path+'#messages',action:'Open conversation',audit:'message.read'})
    for(const a of m.attachments)records.push({id:a.id,messageId:m.id,title:a.filename,type:'message_attachment',date:date(m.sentAt),text:[a.filename,m.body].join('\n'),filename:a.filename,byteLength:a.byteLength,
      url:'/api/balm/messages/attachments/'+a.id,action:'Download attachment',audit:'message.read'})
  }
  return records
}
