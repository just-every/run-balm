import {one} from '../domain/model'
import { validateCoding } from '../codesets'
import type { ClaimSnapshot } from './types'
/** The only attestations supplied here came from exact, signed clinical revisions. */
export async function claimCoding(db:D1Database,facts:ClaimSnapshot,batchPeers:{invoiceId:string;lines:ClaimSnapshot['lines']}[]=[]) {
 if(!facts.lines.length||!facts.diagnoses.length||facts.lines.some(l=>!Number.isSafeInteger(l.units)||l.units<=0))return undefined
 const invoice=await one(db,'SELECT client_id FROM bm_invoices WHERE id=?',facts.invoiceId)
 return validateCoding(db,{date:facts.serviceDate,diagnoses:facts.diagnoses,lines:facts.lines,attestations:facts.distinctServices,clientId:invoice?.client_id,renderingNpi:facts.rendering.npi,invoiceId:facts.invoiceId,batchPeers})
}
