import { insist } from '../domain/model'
import type { ClaimSnapshot } from './types'
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
/** Inches measured against the NUCC 02/12 grid. Output deliberately has no
 * substitute background: it is printed at 100% on an approved red form. */
export function cms1500(c:ClaimSnapshot,claimId:string) {
 insist(c.lines.length<=6,'CMS1500_supports_six_service_lines_use_electronic_for_longer_claims')
 const fields:string[]=[],birth=(date:string)=>date?date.slice(5,7)+' '+date.slice(8,10)+' '+date.slice(0,4):''
 const put=(left:number,top:number,value:unknown,width=2,font=10)=>fields.push(`<span style="left:${left}in;top:${top}in;width:${width}in;font-size:${font}pt">${escape(value)}</span>`)
 put(5.0,.55,c.payer.name,2.9)
 put(c.payer.medicare ? .35 : 4.95,1.5,'X',.16);put(5.25,1.5,c.subscriber.memberId,2.9)
 put(.35,1.84,`${c.patient.last}, ${c.patient.first}`,2.8);put(3.35,1.84,birth(c.patient.dob),1.2)
 if(['M','F'].includes(c.patient.sex))put(c.patient.sex==='M'?4.45:4.95,1.84,'X',.16)
 put(5.25,1.84,`${c.subscriber.last}, ${c.subscriber.first}`,2.9)
 put(.35,2.17,c.address.street,2.8);put(5.25,2.17,c.address.street,2.9)
 const relation:Record<string,number>={'18':3.6,'01':4.1,'19':4.5};put(relation[c.subscriber.relationship]??5.0,2.17,'X',.16)
 put(.35,2.5,c.address.city,2.4);put(2.85,2.5,c.address.state,.3);put(.35,2.84,c.address.postal,1)
 put(5.25,2.5,c.address.city,2.3);put(7.85,2.5,c.address.state,.3);put(5.25,2.84,c.address.postal,1)
 put(5.25,3.17,c.subscriber.group,2.9);put(5.55,3.5,birth(c.subscriber.dob),1.3)
 if(['M','F'].includes(c.subscriber.sex))put(c.subscriber.sex==='M'?7.1:7.8,3.5,'X',.16)
 put(5.25,4.17,c.payer.name,2.9)
 const prior=c.cob?.prior[0]
 put(prior?5.45:5.95,4.5,'X',.16)
 if(prior){put(.35,3.17,`${prior.subscriber.last}, ${prior.subscriber.first}`,2.8);put(.35,3.5,prior.subscriber.group||prior.subscriber.memberId,2.8);put(.35,4.5,prior.payer.name,2.8)}
 if(c.referring){put(.35,5.5,`DN ${c.referring.first} ${c.referring.last}`,2.6);put(3.45,5.5,c.referring.npi,1.5)}
 put(4.5,6.34,'0',.16)
 c.diagnoses.slice(0,12).forEach((d,n)=>put(.55+(n%4)*1.3,6.5+Math.floor(n/4)*.16,d.replace('.',''),1.1))
 if(c.frequency==='7'){put(5.25,6.5,'7',.25);put(5.65,6.5,c.originalControl,2.5)}
 if(c.authorization)put(5.25,6.83,c.authorization,2.9)
 c.lines.forEach((l,n)=>{const y=7.45+n/3,date=c.serviceDate.slice(5).replace('-',' ')+' '+c.serviceDate.slice(2,4);put(.35,y,date,.9);put(1.25,y,date,.9);put(2.15,y,'11',.3);put(2.85,y,l.code,.6);put(3.55,y,l.modifiers.join(' '),1);put(4.85,y,l.diagnosisPointers.map(p=>String.fromCharCode(64+p)).join(''),.45);put(5.35,y,(l.amountCents/100).toFixed(2),.75);put(6.2,y,l.units,.3);put(7.05,y,c.rendering.npi,1.15)})
 put(.35,9.45,c.billing.taxId,1.3);put(2.55,9.45,claimId,1.4,4.5);put(5.35,9.45,(c.lines.reduce((t,l)=>t+l.amountCents,0)/100).toFixed(2),.8);put(6.5,9.45,((prior?.paidCents??0)/100).toFixed(2),.8)
 put(6.9,9.65,c.billing.phone,1.2);put(5.25,9.78,c.billing.name,2.9);put(5.25,9.95,c.billing.address,2.9);put(5.25,10.12,`${c.billing.city}, ${c.billing.state} ${c.billing.postal}`,2.9);put(5.4,10.3,c.billing.npi,1.5)
 return `<!doctype html><html><head><meta charset="utf-8"><title>CMS-1500 · ${escape(claimId)}</title><style>@page{size:letter;margin:0}body{margin:0;font:10pt Courier,monospace}.form{position:relative;width:8.5in;height:11in}.form span{position:absolute;white-space:nowrap;overflow:hidden;line-height:.15in}.instructions{font:16px system-ui;padding:20px}@media screen{.form{zoom:calc(min(100vw, 816px) / 816px)}}@media print{.instructions{display:none}}</style></head><body><div class="instructions"><h1>CMS-1500 (02/12)</h1><p>Print at 100% on an approved preprinted red CMS-1500 form. Disable browser headers and footers; check alignment against your stock. Review every field against the original EOB and your payer’s instructions. Complete patient authorization signatures (12–13), assignment election (27), service-facility details (32) when required, and the provider signature (31) before mailing. The print preview contains recorded facts and does not supply signatures or an assignment election. Attach the primary payer’s original EOB downloaded with this packet. Printing records no submission.</p></div><div class="form">${fields.join('')}</div></body></html>`
}
