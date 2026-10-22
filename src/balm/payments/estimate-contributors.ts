import { day,insist,integer,text } from '../domain/model'
import { dollars } from '../domain/invoices'
import { parseIcd10,validNpi } from './codes'
import type { Block } from './pdf'

type QuoteLine = {name:string;code:string;quantity:number;unitCents:number;totalCents:number}
export type EstimateContributor = {name:string;npi:string;taxId:string;address:string;sourceReference:string;receivedOn:string;diagnosisCodes:string[];lines:QuoteLine[];attest:true;totalCents:number}

/** Hand-entered written quotes only; this records provenance and never contacts a provider. */
export function estimateContributors(input:unknown,practiceNpi:unknown):EstimateContributor[]{
 if(input===undefined)return []
 insist(Array.isArray(input)&&input.length<=8,'enter_at_most_eight_contributing_providers')
 const npis=new Set(practiceNpi?[String(practiceNpi).trim()]:[])
 return input.map(item=>{
  insist(item&&typeof item==='object'&&!Array.isArray(item),'invalid_contributing_provider')
  insist(item.attest===true,'confirm_the_contributing_provider_written_quote')
  const name=text(item.name,'contributing_provider_name',200),npi=text(item.npi,'contributing_provider_npi',10)
  insist(validNpi(npi),'enter_a_valid_contributing_provider_NPI')
  insist(!npis.has(npi),'a_provider_NPI_is_listed_twice');npis.add(npi)
  const taxId=text(item.taxId,'contributing_provider_tax_id',11)
  insist(/^\d{9}$|^\d{2}-\d{7}$|^\d{3}-\d{2}-\d{4}$/.test(taxId),'enter_a_nine_digit_contributing_provider_tax_id')
  const address=text(item.address,'contributing_provider_address',300),sourceReference=text(item.sourceReference,'written_quote_reference',500)
  const receivedDate=text(item.receivedOn,'quote_received_on',10)
  insist(/^\d{4}-\d\d-\d\d$/.test(receivedDate)&&Number.isFinite(Date.parse(receivedDate+'T00:00:00Z')),'invalid_quote_received_on')
  const receivedOn=day(receivedDate,'quote_received_on')
  insist(Array.isArray(item.diagnosisCodes)&&item.diagnosisCodes.length>0,'record_contributing_provider_diagnosis_codes')
  const diagnosisCodes=parseIcd10(item.diagnosisCodes.map((code:unknown)=>text(code,'contributing_provider_diagnosis_code',8)).join(','))
  insist(Array.isArray(item.lines)&&item.lines.length>0&&item.lines.length<=40,'enter_the_contributing_provider_expected_services')
  const lines:QuoteLine[]=item.lines.map((line:Record<string,unknown>)=>{
   insist(line&&typeof line==='object'&&!Array.isArray(line),'invalid_contributing_provider_service')
   const name=text(line.name,'contributing_provider_service',200),code=text(line.code,'contributing_provider_service_code',5)
   insist(/^(?:[0-9]{5}|[A-Z][0-9]{4}|[0-9]{4}[A-Z])$/.test(code),'record_a_service_code_for_every_contributing_provider_line')
   const quantity=integer(line.quantity,'quoted_quantity',1,1_000_000_000),unitCents=integer(line.unitCents,'quoted_unit_cents',1,1_000_000_000),totalCents=quantity*unitCents
   insist(Number.isSafeInteger(totalCents)&&totalCents<=1_000_000_000,'estimate_total_too_large')
   return {name,code,quantity,unitCents,totalCents}
  })
  const totalCents=lines.reduce((sum,line)=>sum+line.totalCents,0)
  insist(totalCents<=1_000_000_000,'estimate_total_too_large')
  return {name,npi,taxId,address,sourceReference,receivedOn,diagnosisCodes,lines,attest:true,totalCents}
 })
}

export function contributorQuoteBlocks(contributors:EstimateContributor[]):Block[]{
 return contributors.flatMap(provider=>[
  {kind:'heading',text:'Contributing provider: '+provider.name},
  {kind:'facts',rows:[['Responsible provider',provider.name],['Provider NPI',provider.npi],['Tax ID',provider.taxId],['Provider address',provider.address],['Written quote reference',provider.sourceReference],['Quote received',provider.receivedOn],['Diagnosis codes',provider.diagnosisCodes.join(', ')],['Preparer confirmation','Written provider quote checked and recorded']]},
  {kind:'table',columns:[{label:'Expected service',width:4},{label:'Code',width:1},{label:'Quantity',width:1,right:true},{label:'Each',width:1.5,right:true},{label:'Expected charge',width:2,right:true}],rows:provider.lines.map(line=>[line.name,line.code,String(line.quantity),dollars(line.unitCents),dollars(line.totalCents)]),totals:[['Provider subtotal',dollars(provider.totalCents)]]}
 ] as Block[])
}
