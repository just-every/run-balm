import { insist } from '../domain/model'
import type { ClaimSnapshot } from './types'
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
/** Inches measured against the NUCC 02/12 grid. Output deliberately has no
 * substitute background: it is printed at 100% on an approved red form. */
export function cms1500(c:ClaimSnapshot,claimId:string) {
 insist(c.lines.length<=6,'CMS1500_supports_six_service_lines_use_electronic_for_longer_claims')
 const fields:string[]=[],birth=(date:string)=>date?date.slice(5,7)+' '+date.slice(8,10)+' '+date.slice(0,4):''
 const put=(left:number,top:number,value:unknown,width=2)=>fields.push(`<span style="left:${left}in;top:${top}in;width:${width}in">${escape(value)}</span>`)
 put(5.1,.6,c.payer.name,2.5)
 put(c.payer.medicare ? .38 : 3.37,1.64,'X',.2);put(4.52,1.64,c.subscriber.memberId,3.5)
 put(.37,1.98,`${c.patient.last}, ${c.patient.first}`,3);put(3.12,1.98,birth(c.patient.dob),1.2);put(c.patient.sex==='M'?4.0:4.38,1.98,'X',.2)
 put(4.65,1.98,`${c.subscriber.last}, ${c.subscriber.first}`,3)
 put(.37,2.32,c.address.street,2.8);put(3.2,2.32,c.subscriber.relationship==='18'?'X':'',.2);put(4.65,2.32,c.address.street,3)
 put(.37,2.66,c.address.city,2);put(2.68,2.66,c.address.state,.4);put(.37,3.0,c.address.postal,1.5)
 put(4.65,2.66,c.address.city,2);put(7.2,2.66,c.address.state,.4);put(4.65,3.0,c.address.postal,1.5)
 put(4.65,3.34,c.subscriber.group,3);put(4.65,3.68,birth(c.subscriber.dob),1.5);put(4.65,4.02,c.payer.name,3)
 const prior=c.cob?.prior[0]
 if(prior){put(.37,3.34,`${prior.subscriber.last}, ${prior.subscriber.first}`,3);put(.37,3.68,prior.subscriber.memberId,3);put(.37,4.36,prior.payer.name,3)}
 if(c.referring){put(.37,5.38,`${c.referring.first} ${c.referring.last}`,2.7);put(3.3,5.38,c.referring.npi,1.4)}
 c.diagnoses.slice(0,12).forEach((d,n)=>put(.5+(n%4)*1.02,6.32+Math.floor(n/4)*.24,d,1))
 if(c.frequency==='7'){put(5.0,6.32,'7',.3);put(5.4,6.32,c.originalControl,2.4)}
 if(c.authorization)put(4.7,6.8,c.authorization,3)
 c.lines.forEach((l,n)=>{const y=7.12+n*.34,date=c.serviceDate.slice(5).replace('-',' ' )+' '+c.serviceDate.slice(2,4);put(.35,y,date,1.1);put(1.35,y,date,1.1);put(2.43,y,'11',.3);put(2.94,y,l.code,.6);put(3.54,y,l.modifiers.join(' '),1.1);put(4.75,y,l.diagnosisPointers.map(p=>String.fromCharCode(64+p)).join(''),.6);put(5.47,y,(l.amountCents/100).toFixed(2),.7);put(6.27,y,l.units,.4);put(6.98,y,c.rendering.npi,1)})
 put(.38,9.25,c.billing.taxId,1.5);put(2.25,9.25,claimId,2);put(4.8,9.25,'X',.2);put(5.5,9.25,(c.lines.reduce((t,l)=>t+l.amountCents,0)/100).toFixed(2),.7);put(6.4,9.25,((prior?.paidCents??0)/100).toFixed(2),.7)
 put(5.1,9.65,c.billing.phone,2);put(5.1,9.95,c.billing.name,2.9);put(5.1,10.13,c.billing.address,2.9);put(5.1,10.31,`${c.billing.city}, ${c.billing.state} ${c.billing.postal}`,2.9);put(5.1,10.55,c.billing.npi,1.6)
 return `<!doctype html><html><head><meta charset="utf-8"><title>CMS-1500 · ${escape(claimId)}</title><style>@page{size:letter;margin:0}body{margin:0;font:10pt Courier,monospace}.form{position:relative;width:8.5in;height:11in}.form span{position:absolute;white-space:nowrap;overflow:hidden;line-height:.15in}.instructions{font:16px system-ui;padding:20px}@media print{.instructions{display:none}}</style></head><body><div class="instructions"><h1>CMS-1500 (02/12)</h1><p>Print at 100% on an approved preprinted red CMS-1500 form. Disable browser headers and footers; check alignment against your stock. The billing provider must review and sign box 31. Attach the primary payer’s original EOB downloaded with this packet. Printing records no submission.</p></div><div class="form">${fields.join('')}</div></body></html>`
}
