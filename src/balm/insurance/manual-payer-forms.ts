import {parseDollars} from '../payments/ledger'
import type {Data} from '../domain/model'
export function manualPayerForm(input:Data) {
 if(input.manualPayerForm!=='on'||input.kind!=='payment')return input
 const adjustments=[]
 for(let n=0;n<3;n++)if(input[`adj_${n}_group`])adjustments.push({group:input[`adj_${n}_group`],reason:input[`adj_${n}_reason`],amountCents:parseDollars(input[`adj_${n}_amount`],'adjustment')})
 return {...input,billedCents:parseDollars(input.billed,'billed_amount'),allowedCents:parseDollars(input.allowed,'allowed_amount'),paidCents:parseDollars(input.paid,'payer_payment'),adjustments,remarks:String(input.remarks??'').split(/[\s,]+/).filter(Boolean)}
}
