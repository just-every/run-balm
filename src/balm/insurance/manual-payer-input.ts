import {insist,text,type Data} from '../domain/model'

export const cents = (value:unknown,field:string,positive=false) => {
 const n=Number(value);insist(Number.isSafeInteger(n)&&n>=(positive?1:0)&&n<=100000000,`invalid_${field}`);return n
}
export function manualLine(input:Data) {
 const kind=text(input.kind,'line_kind',30);insist(['payment','interest','recoupment'].includes(kind),'invalid_line_kind')
 const reason=text(input.reason,'source_or_reason',500)
 if(kind!=='payment')return {kind,reason,amountCents:cents(input.amountCents,'amount',true)}
 const billedCents=cents(input.billedCents,'billed',true),allowedCents=cents(input.allowedCents,'allowed'),paidCents=cents(input.paidCents,'paid')
 const adjudication=input.adjudication==='denied'?'denied':'paid'
 insist(Array.isArray(input.adjustments)&&input.adjustments.length<=20,'enter_adjustments_from_the_eob')
 const adjustments=input.adjustments.map((a:Data)=>{
  const group=text(a.group,'CARC_group',2),reason=text(a.reason,'CARC_reason',10)
  insist(['CO','PR','OA','PI'].includes(group)&&/^\d{1,5}$/.test(reason),'invalid_CARC_code')
  return {group,reason,amountCents:cents(a.amountCents,'adjustment',true)}
 })
 const prCents=adjustments.filter(a=>a.group==='PR').reduce((t,a)=>t+a.amountCents,0)
 const payerAdjustments=adjustments.filter(a=>a.group!=='PR').reduce((t,a)=>t+a.amountCents,0)
 insist(billedCents===paidCents+prCents+payerAdjustments,'claim_line_does_not_balance')
 insist(allowedCents===paidCents+prCents,'allowed_must_equal_paid_plus_patient_responsibility')
 insist(adjudication!=='denied'||paidCents===0,'denied_line_cannot_include_payment')
 const remarks=(Array.isArray(input.remarks)?input.remarks:[]).map((r:unknown)=>text(r,'RARC',10))
 insist(remarks.length<=20&&remarks.every((r:string)=>/^[A-Z]\d{1,5}$/.test(r)),'invalid_RARC_code')
 return {kind,reason,billedCents,allowedCents,paidCents,prCents,adjustments,remarks,adjudication,adjustmentCents:adjudication==='denied'?0:payerAdjustments,payerControl:String(input.payerControl??'').trim().slice(0,100)}
}
