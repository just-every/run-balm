import { guard, rows } from '../domain/model'
import type { CodingLine } from './edits'
export type PriorContext={clientId:string;date:string;renderingNpi:string;excludeInvoices:string[];fingerprint:string}
const eligible="status IN ('batched','exported','submitted','accepted','paid','partial','denied')"
/** One rendering service per invoice, even when primary and subsequent payers
 * have separate claims for that same performed service. */
const selection=`client_id=? AND service_date=? AND json_extract(snapshot,'$.rendering.npi')=? AND invoice_id NOT IN (SELECT value FROM json_each(?)) AND ${eligible}
 AND NOT EXISTS(SELECT 1 FROM bm_claims newer WHERE newer.invoice_id=bm_claims.invoice_id AND newer.${eligible} AND (newer.created_at>bm_claims.created_at OR (newer.created_at=bm_claims.created_at AND newer.id>bm_claims.id)))`
const args=(c:Omit<PriorContext,'fingerprint'>)=>[c.clientId,c.date,c.renderingNpi,JSON.stringify(c.excludeInvoices)]
const fingerprintSql=`SELECT json_group_array(json_array(id,version)) FROM (SELECT id,version FROM bm_claims WHERE ${selection} ORDER BY id)`
export async function priorServices(db:D1Database,context:Omit<PriorContext,'fingerprint'>) {
 const values=args(context)
 // One statement returns both the selected versions and their service lines.
 const claims=await rows(db,`SELECT id,version,json_extract(snapshot,'$.lines') AS lines FROM bm_claims WHERE ${selection} ORDER BY id`,...values)
 return {context:{...context,fingerprint:JSON.stringify(claims.map(c=>[c.id,c.version]))},lines:claims.flatMap(c=>JSON.parse(c.lines)) as CodingLine[]}
}
export const priorContextGuard=(db:D1Database,context:PriorContext)=>guard(db,`(${fingerprintSql})=?`,...args(context),context.fingerprint)
