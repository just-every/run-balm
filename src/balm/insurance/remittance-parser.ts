import { insist } from '../domain/model'
import { cents, parseX12 } from './x12'

export type Adjustment={group:'CO'|'PR';reason:string;amountCents:number;line:number|null}
export type RemitClaim={id:string;status:string;chargeCents:number;paidCents:number;prCents:number;control:string;adjustments:Adjustment[];remarks:string[];lines:{code:string;chargeCents:number;paidCents:number;adjustments:Adjustment[]}[]}
export function parseRemittance(raw:unknown) {
  const parsed=parseX12(raw,'835'),segments=parsed.segments
  insist(!segments.some(s=>s[0]==='PLB'),'remittance_provider_adjustments_not_supported_import_nothing')
  insist(!segments.some(s=>s[0]==='CUR'&&s[2]!=='USD'),'remittance_currency_must_be_usd')
  const bpr=segments.filter(s=>s[0]==='BPR'),trn=segments.filter(s=>s[0]==='TRN'),payers=segments.filter(s=>s[0]==='N1'&&s[1]==='PR')
  insist(bpr.length===1,'remittance_requires_one_payment_information_segment')
  insist(trn.length===1&&trn[0][2],'remittance_payment_trace_required_in_trn')
  insist(payers.length===1&&payers[0][2],'remittance_payer_name_required_in_n1_pr')
  // REF*2U identifies the payer only inside its N1 loop. A payee or a
  // claim-level reference must never override the selected payer's identity.
  const payer=payers[0],payerStart=segments.indexOf(payer),payerReferences=[] as string[]
  for(const s of segments.slice(payerStart+1)) {
    if(s[0]==='N1'||s[0]==='CLP')break
    if(s[0]==='REF'&&s[1]==='2U'&&s[2])payerReferences.push(s[2])
  }
  const payerCodes=[...(payer[4]?[payer[4]]:[]),...payerReferences]
  insist(bpr[0][3]==='C','remittance_debit_or_reversal_not_supported')
  const amount=cents(bpr[0][2],'deposit'),claims:RemitClaim[]=[]
  let current:RemitClaim|null=null,line:number|null=null
  for(const s of segments) {
    if(s[0]==='CLP') {
      insist(['1','2','3','4'].includes(s[2]),'remittance_claim_status_not_supported_no_reversals')
      current={id:s[1],status:s[2],chargeCents:cents(s[3],'claim_charge'),paidCents:cents(s[4],'claim_paid'),prCents:s[5]?cents(s[5],'patient_responsibility'):0,control:s[7]??'',adjustments:[],remarks:[],lines:[]};claims.push(current);line=null
      insist(s[2]!=='4'||current.paidCents===0,'denied_claim_cannot_have_payment')
    } else if(s[0]==='SVC'&&current) {
      const composite=s[1].split(parsed.component);insist(composite[0]==='HC','remittance_only_hcpcs_service_lines_supported')
      current.lines.push({code:composite[1],chargeCents:cents(s[2],'service_charge'),paidCents:cents(s[3],'service_paid'),adjustments:[]});line=current.lines.length-1
    } else if(s[0]==='CAS'&&current) {
      insist(s[1]==='CO'||s[1]==='PR','remittance_adjustment_group_not_supported')
      for(let i=2;i<s.length;i+=3)if(s[i]) {
        insist(/^\d{1,3}$/.test(s[i]),'remittance_invalid_adjustment_reason')
        const a:Adjustment={group:s[1],reason:s[i],amountCents:cents(s[i+1],'adjustment'),line}
        current.adjustments.push(a);if(line!==null)current.lines[line].adjustments.push(a)
      }
    } else if(s[0]==='LQ'&&current&&s[1]==='HE')current.remarks.push(s[2])
    else if(s[0]==='MIA'&&current)for(const r of [s[5],s[20],s[21],s[22],s[23]].filter(Boolean))current.remarks.push(r)
    else if(s[0]==='MOA'&&current)for(const r of s.slice(3,8).filter(Boolean))current.remarks.push(r)
    else if(s[0]==='AMT'&&current&&s[1]==='I')insist(cents(s[2],'interest')===0,'remittance_interest_not_supported')
  }
  insist(claims.length>0&&new Set(claims.map(c=>c.id)).size===claims.length,'remittance_requires_distinct_claims')
  insist(claims.reduce((sum,c)=>sum+c.paidCents,0)===amount,'remittance_deposit_does_not_balance')
  for(const c of claims) {
    const adjusted=c.adjustments.reduce((sum,a)=>sum+a.amountCents,0),pr=c.adjustments.filter(a=>a.group==='PR').reduce((sum,a)=>sum+a.amountCents,0)
    insist(c.chargeCents===c.paidCents+adjusted,'remittance_claim_does_not_balance')
    insist(c.prCents===pr,'remittance_patient_responsibility_does_not_balance')
    if(c.lines.length) {
      insist(c.lines.reduce((sum,l)=>sum+l.chargeCents,0)===c.chargeCents&&c.lines.reduce((sum,l)=>sum+l.paidCents,0)===c.paidCents,'remittance_services_do_not_match_claim')
      const header=c.adjustments.filter(a=>a.line===null).reduce((sum,a)=>sum+a.amountCents,0)
      // Claim-level adjustments may cover the service delta; do not demand each
      // service balance when the payer explicitly adjusted at claim level.
      if(header===0)for(const l of c.lines)insist(l.chargeCents===l.paidCents+l.adjustments.reduce((t,a)=>t+a.amountCents,0),'remittance_service_does_not_balance')
    }
  }
  return {...parsed,trace:trn[0][2],payerCodes,amountCents:amount,claims}
}
