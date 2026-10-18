import { insist, text } from '../domain/model'

export type Segment = string[]
export const money = (cents: number) => (cents/100).toFixed(2)
export function cents(value: string, field: string, signed = false) {
  insist((signed ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/).test(value),`invalid_x12_${field}`)
  const n = Math.round(Number(value)*100); insist(Number.isSafeInteger(n),`invalid_x12_${field}`); return n
}
/** Reject embedded separators rather than silently changing a patient's identity. */
export function element(value: unknown) {
  const s = String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase()
  insist(!/[*~:^\r\n]|[^\x20-\x7e]/.test(s),'x12_field_contains_unsupported_characters')
  return s
}
export const segment = (...values: unknown[]) => values.map(element).join('*')
export const xdate = (date: string) => date.replace(/-/g,'')
export const control = () => String(crypto.getRandomValues(new Uint32Array(1))[0]%1_000_000_000).padStart(9,'0')
export type Envelope = {sender:string;taxId:string;receiver:string;payerCode:string;production:boolean}
/** Who a file is from and to. Until a clearinghouse assigns IDs, a file names the
 * practice by its federal tax ID (ISA qualifier 30) and the payer by its payer ID. */
export function parties(config:Envelope) {
  return {senderQualifier:config.sender?'ZZ':'30',sender:config.sender||config.taxId,receiver:config.receiver||config.payerCode}
}
export function envelope(kind:'270'|'837', guide:string, config:Envelope, parts:string[], ref=control()) {
  const stamp = new Date().toISOString(), date = stamp.slice(0,10).replace(/-/g,''), time = stamp.slice(11,16).replace(':','')
  const who=parties(config),sender=element(who.sender),receiver=element(who.receiver)
  insist(sender.length<=15 && receiver.length<=15,'x12_interchange_id_too_long')
  const isa=['ISA','00','          ','00','          ',who.senderQualifier,sender.padEnd(15),'ZZ',receiver.padEnd(15),date.slice(2),time,'^','00501',ref,'0',config.production?'P':'T',':'].join('*')
  const group=kind==='270'?'HS':'HC'
  const st=segment('ST',kind,'0001',guide), se=segment('SE',parts.length+2,'0001')
  return [isa,segment('GS',group,sender,receiver,date,time,Number(ref),'X',guide),st,...parts,se,segment('GE',1,Number(ref)),segment('IEA',1,ref)].join('~')+'~\n'
}
export function parseX12(raw: unknown, expected: '271'|'277'|'835'): {segments:Segment[];component:string;body:string} {
  const body=text(raw,'x12',2_000_000).replace(/^\uFEFF/,'')
  let separator='*', terminator='~', component=':'
  if (body.startsWith('ISA')) { insist(body.length>=106,'invalid_x12_envelope'); separator=body[3];component=body[104];terminator=body[105] }
  insist(new Set([separator,terminator,component]).size===3,'invalid_x12_delimiters')
  const segments=body.split(terminator).map(s=>s.trim()).filter(Boolean).map(s=>s.split(separator))
  insist(segments.length<=20000,'x12_too_many_segments')
  const starts=segments.filter(s=>s[0]==='ST')
  insist(starts.length===1 && starts[0][1]===expected,'x12_requires_one_'+expected+'_transaction')
  const start=segments.findIndex(s=>s[0]==='ST'),end=segments.findIndex(s=>s[0]==='SE')
  insist(end>start && Number(segments[end][1])===end-start+1 && segments[end][2]===starts[0][2],'invalid_x12_transaction_count')
  if (segments[0][0]==='ISA') {
    const isa=segments[0],iea=segments.find(s=>s[0]==='IEA'),gs=segments.find(s=>s[0]==='GS'),ge=segments.find(s=>s[0]==='GE')
    insist(iea?.[2]===isa[13] && iea[1]==='1' && ge?.[1]==='1' && gs?.[6]===ge[2],'invalid_x12_envelope_controls')
  }
  return {segments:segments.slice(start+1,end),component,body}
}
