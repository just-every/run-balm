import type { CobAdjustment, CobPrior } from './cob-types'
import type { ClaimLine } from './types'
import { insist } from '../domain/model'
import { element, money, segment as s, xdate } from './x12'
export const payerOrder=(priority:number)=>['','P','S','T'][priority]
const cas=(adjustments:CobAdjustment[])=>adjustments.map(a=>s('CAS',a.group,a.reason,money(a.amountCents),...(a.quantity===undefined?[]:[a.quantity])))
export function otherPayers(prior:CobPrior[]) {
 return prior.flatMap(p=>[
  s('SBR',payerOrder(p.priority),p.subscriber.relationship,p.subscriber.group,'','','','','',p.payer.medicare?'MB':'CI'),
  ...cas(p.adjustments),s('AMT','D',money(p.paidCents)),s('OI','','','Y','','','Y'),
  s('NM1','IL',1,p.subscriber.last,p.subscriber.first,'','','','MI',p.subscriber.memberId),
  s('NM1','PR',2,p.payer.name,'','','','','PI',p.payer.code),s('REF','F8',p.payerControl)
 ])
}
export function lineAdjudications(prior:CobPrior[],line:ClaimLine) {
 return prior.flatMap(p=>p.lines.filter(l=>l.code===line.code).flatMap(l=>{
  insist(l.adjudicatedOn&&l.units!==null,'prior_line_adjudication_date_and_units_required')
  return [`SVD*${element(p.payer.code)}*${money(l.paidCents)}*HC:${[l.code,...l.modifiers].map(element).join(':')}**${l.units}`,...cas(l.adjustments),s('DTP','573','D8',xdate(l.adjudicatedOn))]
 }))
}
