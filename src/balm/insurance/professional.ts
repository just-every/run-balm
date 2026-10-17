import { insist } from '../domain/model'
import type { ClaimSnapshot } from './types'
import { envelope, money, segment as s, xdate } from './x12'

/** 5010 professional, primary claims. Institutional/COB claims require other
 * loops and are refused by the preparation door instead of emitting guesses. */
export function professionalBatch(claims:{id:string;snapshot:ClaimSnapshot}[],batchId:string) {
  insist(claims.length>0,'claim_batch_empty')
  const first=claims[0].snapshot,b=first.billing
  const parts=[s('BHT','0019','00',batchId.replace(/-/g,''),xdate(new Date().toISOString().slice(0,10)),new Date().toISOString().slice(11,16).replace(':',''),'CH'),
    s('NM1','41',2,b.name,'','','','','46',b.sender),s('PER','IC',b.contact,'TE',b.phone),
    s('NM1','40',2,first.payer.name,'','','','','46',first.payer.receiver),
    s('HL',1,'',20,1),s('NM1','85',2,b.name,'','','','','XX',b.npi),s('N3',b.address),s('N4',b.city,b.state,b.postal),s('REF','EI',b.taxId)]
  let hl=1
  for(const claim of claims) {
    const c=claim.snapshot,sub=++hl,self=c.subscriber.relationship==='18'
    parts.push(s('HL',sub,1,22,self?0:1),s('SBR','P',self?'18':'',c.subscriber.group,'','','','','',c.payer.medicare?'MB':'CI'),
      s('NM1','IL',1,c.subscriber.last,c.subscriber.first,'','','','MI',c.subscriber.memberId))
    if(self)parts.push(s('N3',c.address.street),s('N4',c.address.city,c.address.state,c.address.postal),s('DMG','D8',xdate(c.subscriber.dob),c.subscriber.sex))
    parts.push(s('NM1','PR',2,c.payer.name,'','','','','PI',c.payer.code))
    if(!self)parts.push(s('HL',++hl,sub,23,0),s('PAT',c.subscriber.relationship),s('NM1','QC',1,c.patient.last,c.patient.first),s('N3',c.address.street),s('N4',c.address.city,c.address.state,c.address.postal),s('DMG','D8',xdate(c.patient.dob),c.patient.sex))
    const total=c.lines.reduce((sum,l)=>sum+l.amountCents,0)
    // Composite separators belong to composites, never to external values.
    parts.push(`CLM*${claim.id}*${money(total)}***11:B:${c.frequency}*Y*A*Y*I`)
    if(c.authorization)parts.push(s('REF','G1',c.authorization))
    if(c.frequency==='7')parts.push(s('REF','F8',c.originalControl))
    parts.push('HI*'+c.diagnoses.map((d,i)=>`${i===0?'ABK':'ABF'}:${d.replace('.','')}`).join('*'))
    if(c.referring)parts.push(s('NM1','DN',1,c.referring.last,c.referring.first,'','','','XX',c.referring.npi))
    parts.push(s('NM1','82',1,c.rendering.last,c.rendering.first,'','','','XX',c.rendering.npi),s('PRV','PE','PXC',c.rendering.taxonomy))
    c.lines.forEach((line,i)=>{
      parts.push(s('LX',i+1),`SV1*HC:${line.code}${line.modifiers.length?':'+line.modifiers.join(':'):''}*${money(line.amountCents)}*UN*${line.units}***${line.diagnosisPointers.join(':')}`,s('DTP','472','D8',xdate(c.serviceDate)),s('REF','6R',`${claim.id.replace(/-/g,'')}${i+1}`))
    })
  }
  return envelope('837','005010X222A1',{sender:b.sender,receiver:first.payer.receiver,production:b.production},parts)
}
