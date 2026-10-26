import { baaBlock } from '../domain/readiness'
import { managedInstall } from '../payments/stripe-api'
import { DomainError, insist } from '../domain/model'
import type { InsuranceEnv } from './types'

export type InsuranceSubmission = {kind:'270'|'837P';id:string;body:string;sha256:string}
export type InsuranceSubmissionResult = {status:'submitted';reference:string}|{status:'unavailable';reason:string}
export interface InsuranceAdapter { submit(input:InsuranceSubmission):Promise<InsuranceSubmissionResult> }
export const INSURANCE_UNAVAILABLE='No clearinghouse is connected to this Balm, so Balm does not send claims itself: download each claim file and upload the payer’s answer here.'
export async function adapterStatus(env:InsuranceEnv) {
  if (managedInstall(env)) return {available:false,reason:'RER Managed hosting cannot connect a clearinghouse yet, so Balm does not send claims itself: download each claim file and upload the payer’s answer here.'}
  if (!env.BALM_INSURANCE_ADAPTER_URL || !env.BALM_INSURANCE_ADAPTER_TOKEN) return {available:false,reason:INSURANCE_UNAVAILABLE}
  try { const url=new URL(env.BALM_INSURANCE_ADAPTER_URL); if(url.protocol!=='https:'||url.username||url.password||url.hash) return {available:false,reason:'Configure an HTTPS insurance adapter endpoint and credential.'} } catch { return {available:false,reason:'Configure a valid HTTPS insurance adapter endpoint.'} }
  const baa=await baaBlock(env.DB,'clearinghouse')
  if(baa)return {available:false,reason:baa}
  return {available:true,reason:null}
}
/** The install's explicitly configured gateway accepts JSON with raw X12 and an
 * idempotency key. Redirects are refused so the bearer credential cannot move. */
export function insuranceAdapter(env:InsuranceEnv):InsuranceAdapter {
  return {async submit(input) {
    const status=await adapterStatus(env)
    if (!status.available) return {status:'unavailable',reason:status.reason!}
    let response:Response
    try { response=await fetch(env.BALM_INSURANCE_ADAPTER_URL!,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json',authorization:`Bearer ${env.BALM_INSURANCE_ADAPTER_TOKEN}`,'idempotency-key':input.id},body:JSON.stringify(input)}) }
    catch { throw new DomainError('insurance_submission_outcome_unknown_check_gateway_before_resubmitting',409) }
    if (!response.ok) throw new DomainError('insurance_adapter_refused_submission_check_gateway',409)
    const result=await response.json().catch(()=>null) as {status?:unknown;reference?:unknown}|null
    insist(result?.status==='submitted' && typeof result.reference==='string' && /^[\x20-\x7e]{1,150}$/.test(result.reference),'insurance_adapter_response_invalid_check_gateway',409)
    return {status:'submitted',reference:result.reference}
  }}
}
