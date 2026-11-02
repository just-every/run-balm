import {insist} from '../domain/model'
import type {ClaimSnapshot} from './types'
import {envelope,money,parties,segment as s,xdate} from './x12'

/** Original single-visit outpatient test exports. Recorded codes are not payer certification. */
export function institutionalBatch(claims:{id:string;snapshot:ClaimSnapshot}[],batchId:string){
 insist(claims.length>0,'claim_batch_empty')
 const first=claims[0].snapshot,b=first.billing
 const config={sender:b.sender,taxId:b.taxId,receiver:first.payer.receiver,payerCode:first.payer.code,production:false},who=parties(config),stamp=new Date().toISOString()
 const parts=[s('BHT','0019','00',batchId.replace(/-/g,''),xdate(stamp.slice(0,10)),stamp.slice(11,16).replace(':',''),'CH'),
 s('NM1','41',2,b.name,'','','','','46',who.sender),s('PER','IC',b.contact,'TE',b.phone),s('NM1','40',2,first.payer.name,'','','','','46',who.receiver),
 s('HL',1,'',20,1),s('NM1','85',2,b.name,'','','','','XX',b.npi),s('N3',b.address),s('N4',b.city,b.state,b.postal),s('REF','EI',b.taxId)]
 for(const [n,claim] of claims.entries()){
  const c=claim.snapshot,i=c.institutional
  insist(i&&i.billType==='741'&&c.frequency==='1'&&!c.cob&&!c.injury&&c.payer.medicare&&c.subscriber.relationship==='18','institutional_original_primary_self_medicare_only')
  parts.push(s('HL',n+2,1,22,0),s('SBR','P','18',c.subscriber.group,'','','','','','MB'),s('NM1','IL',1,c.subscriber.last,c.subscriber.first,'','','','MI',c.subscriber.memberId),s('N3',c.address.street),s('N4',c.address.city,c.address.state,c.address.postal),s('DMG','D8',xdate(c.subscriber.dob),c.subscriber.sex),s('NM1','PR',2,c.payer.name,'','','','','PI',c.payer.code),
  `CLM*${claim.id}*${money(c.lines.reduce((t,l)=>t+l.amountCents,0))}***74:A:1**A*Y*I`,s('DTP','434','RD8',xdate(c.serviceDate)+'-'+xdate(c.serviceDate)),s('CL1','','',i.patientStatus),
  `HI*ABK:${c.diagnoses[0].replace('.','')}`)
  // X223A2 separates the principal diagnosis; other diagnoses and occurrences use up to 12 composites per HI.
  if(c.diagnoses.length>1)parts.push('HI*'+c.diagnoses.slice(1).map(d=>`ABF:${d.replace('.','')}`).join('*'))
  parts.push(`HI*BI:${i.planSpanCode}:RD8:${xdate(i.plan.startDate)}-${xdate(i.plan.throughDate)}`,
  'HI*'+i.occurrences.map(o=>`BH:${o.code}:D8:${xdate(o.date)}`).join('*'))
  if(c.authorization)parts.push(s('REF','G1',c.authorization))
  parts.push(s('NM1','71',1,i.attending.last,i.attending.first,'','','','XX',i.attending.npi))
  if(c.referring)parts.push(s('NM1','DN',1,c.referring.last,c.referring.first,'','','','XX',c.referring.npi))
  parts.push(s('NM1','82',1,c.rendering.last,c.rendering.first,'','','','XX',c.rendering.npi))
  c.lines.forEach((l,n)=>{
   const revenue=i.mappings.find(m=>m.code===l.code);insist(revenue,'institutional_revenue_mapping_missing')
   parts.push(s('LX',n+1),`SV2*${revenue.revenueCode}*HC:${l.code}${l.modifiers.length?':'+l.modifiers.join(':'):''}*${money(l.amountCents)}*UN*${l.units}`,s('DTP','472','D8',xdate(c.serviceDate)),s('REF','6R',claim.id.replace(/-/g,'')+String(n+1)))
  })
 }
 return envelope('837','005010X223A2',config,parts)
}
