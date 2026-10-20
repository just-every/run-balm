// Where a case stands, stage by stage, from referral to paid or denied. Each
// stage is a rule over the case's records and cites the record it rests on.
import { dollars } from '../domain/invoices'
import { payerReason } from '../insurance/codes'
import { template } from '../charting/templates'
import type { Data } from '../domain/model'
import type { CaseFacts, Citation, Stage } from './types'

export const STALE_DAYS = 30
export const EXPIRY_DAYS = 14
const SENT = ['batched', 'exported', 'submitted', 'accepted', 'paid', 'partial', 'denied', 'rejected']
const ERA = '/app/insurance#era'
export const FIX = ['denied', 'rejected', 'partial']

/** A calendar date (YYYY-MM-DD) or an instant, as Oct 3, 2026 in the clinic's zone. */
export function usDay(value: string, zone: string) {
  const plain = /^\d{4}-\d\d-\d\d$/.test(value)
  return new Intl.DateTimeFormat('en-US', { timeZone: plain ? 'UTC' : zone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(plain ? value + 'T00:00:00Z' : value))
}
const days = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400_000)
const file = (f: CaseFacts, anchor: string) => `/app/clients/${f.client.id}#${anchor}`

export const cite = {
  referral: (f: CaseFacts): Citation => ({ kind: 'referral', label: `Referral from ${f.referral.referring_first} ${f.referral.referring_last}${f.referral.referring_npi ? `, NPI ${f.referral.referring_npi}` : ''}, received ${usDay(f.referral.received_on, f.zone)}`, href: `/app/cases#case-${f.referral.id}` }),
  policy: (f: CaseFacts): Citation => ({ kind: 'policy', label: `${f.policy!.payer_name} policy, member ${f.policy!.member_id}`, href: file(f, 'insurance') }),
  eligibility: (f: CaseFacts): Citation => ({ kind: 'eligibility', label: `Eligibility ${f.eligibility!.status} for ${usDay(f.eligibility!.service_date, f.zone)}${f.eligibility!.checked_at ? `, checked ${usDay(f.eligibility!.checked_at, f.zone)}` : ', no response yet'}`, href: file(f, 'insurance') }),
  authorization: (f: CaseFacts, a: any): Citation => ({ kind: 'authorization', label: `Authorization ${a.number}: ${a.used_allowance} used, ${a.reserved_allowance} ${a.allowance_kind === 'units' ? 'reserved' : 'booked'} of ${a.allowance_total} ${a.allowance_kind}, ${usDay(a.starts_on, f.zone)} to ${usDay(a.ends_on, f.zone)}`, href: file(f, `authorization-${a.id}`) }),
  visit: (f: CaseFacts, v: any): Citation => ({ kind: 'visit', label: `Visit ${usDay(v.start_at, f.zone)}: ${v.service} with ${v.practitioner}, ${v.status}`, href: file(f, `visit-${v.id}`) }),
  note: (f: CaseFacts, n: any): Citation => ({ kind: 'note', label: `${template(n.template)?.title ?? 'Treatment note'} ${n.signed_at ? `signed ${usDay(n.signed_at, f.zone)} by ${n.signer_name}${n.signer_credentials ? ', ' + n.signer_credentials : ''}` : 'not signed'}`, href: file(f, `note-${n.id}`) }),
  claim: (f: CaseFacts, c: any): Citation => ({ kind: 'claim', label: `Claim for ${usDay(c.service_date, f.zone)}, ${dollars(c.amount_cents)}, ${c.status}${c.payer_control ? `, payer control ${c.payer_control}` : ''}`, href: file(f, `claim-${c.id}`) }),
  era: (f: CaseFacts, c: any): Citation => ({ kind: 'era', label: `ERA ${c.era_trace} posted ${usDay(c.era_at, f.zone)}: paid ${dollars(c.paid_cents)}, patient ${dollars(c.pr_cents)}${(c.adjustments?.adjustments ?? []).map((a: any) => `, ${a.group}-${a.reason}`).join('')}${(c.adjustments?.remarks ?? []).map((r: string) => `, ${r}`).join('')}`, href: file(f, `claim-${c.id}`) }),
  statement: (f: CaseFacts): Citation => ({ kind: 'statement', label: `Statement: patient balance ${dollars(f.balanceCents)}`, href: file(f, 'billing') }),
}

/** The authorization a case is counting against: the one covering today, else the latest. */
export function currentAuthorization(f: CaseFacts) {
  const list: Data[] = f.authorizations.map(a => ({ ...a, left: a.remaining_allowance }))
  return list.find(a => a.starts_on <= f.today && a.ends_on >= f.today) ?? list[0] ?? null
}
export const signedNote = (f: CaseFacts, visitId: string) => f.notes.find(n => n.appointment_id === visitId && n.signed_at)
export const attended = (f: CaseFacts) => f.visits.filter(v => v.status === 'attended')
export const unclaimed = (f: CaseFacts) => attended(f).filter(v => signedNote(f, v.id) && f.invoices.some(i => i.appointment_id === v.id && i.status === 'approved') && !f.claims.some(c => c.appointment_id === v.id))

export function stages(f: CaseFacts): Stage[] {
  const out: Stage[] = [{ id: 'referral', label: 'Referral', state: 'done', text: `From ${f.referral.referring_first} ${f.referral.referring_last} · received ${usDay(f.referral.received_on, f.zone)}`, cite: cite.referral(f) }]
  out.push(f.intakeAt ? { id: 'intake', label: 'Intake', state: 'done', text: `Intake received ${usDay(f.intakeAt, f.zone)}` } : { id: 'intake', label: 'Intake', state: 'waiting', text: 'Intake form not returned yet' })
  const p = f.policy, e = f.eligibility
  if (!p) out.push({ id: 'eligibility', label: 'Eligibility', state: 'none', text: 'Self-pay: no insurance policy on this case' })
  else if (e && !e.checked_at) out.push({ id: 'eligibility', label: 'Eligibility', state: 'waiting', text: `Inquiry for ${usDay(e.service_date, f.zone)} prepared ${usDay(e.created_at, f.zone)}; waiting for the payer’s 271`, cite: cite.eligibility(f), next: { text: 'Upload the payer’s 271 answer, or record a check made by phone or on its website, in the patient file', href: file(f, 'insurance') } })
  else if (!p.eligibility_checked_at) out.push({ id: 'eligibility', label: 'Eligibility', state: 'waiting', text: `${p.payer_name} coverage not checked yet`, cite: e ? cite.eligibility(f) : cite.policy(f), next: { text: 'Call the payer or check its website, then record what it said in the patient file', href: file(f, 'insurance') } })
  else if (p.eligibility_status !== 'active') out.push({ id: 'eligibility', label: 'Eligibility', state: 'stalled', text: `Latest response: coverage ${p.eligibility_status}`, cite: e ? cite.eligibility(f) : cite.policy(f), next: { text: 'Confirm coverage with the payer and record the check, or add the patient’s current policy', href: file(f, 'insurance') } })
  else if (days(p.eligibility_checked_at.slice(0, 10), f.today) > STALE_DAYS) out.push({ id: 'eligibility', label: 'Eligibility', state: 'waiting', text: `Active, but last checked ${usDay(p.eligibility_checked_at, f.zone)}`, cite: e ? cite.eligibility(f) : cite.policy(f) })
  else out.push({ id: 'eligibility', label: 'Eligibility', state: 'done', text: `Active · checked ${usDay(p.eligibility_checked_at, f.zone)}`, cite: e ? cite.eligibility(f) : cite.policy(f) })
  const a = currentAuthorization(f)
  if (!p || !a) out.push({ id: 'authorization', label: 'Authorization', state: 'none', text: p ? 'No authorization on file' : 'Not needed for self-pay' })
  else {
    const asked = f.done.find(d => d.status === 'done' && d.step_key.startsWith(`authorization.request:${a.id}:`))
    const text = `${a.left} of ${a.allowance_total} ${a.allowance_kind} left · ${p.payer_name} · ${a.ends_on < f.today ? 'expired' : 'expires'} ${usDay(a.ends_on, f.zone)}${asked ? ` · more visits requested ${usDay(asked.approved_at, f.zone)}` : ''}`
    out.push({ id: 'authorization', label: 'Authorization', state: a.ends_on < f.today || a.left === 0 ? 'stalled' : a.left <= a.low_remainder || days(f.today, a.ends_on) <= EXPIRY_DAYS ? 'waiting' : 'done', text, cite: cite.authorization(f, a) })
  }
  const seen = attended(f), next = f.visits.find(v => v.status === 'booked' && Date.parse(v.start_at) >= Date.now())
  out.push(seen.length ? { id: 'visits', label: 'Visits', state: 'done', text: `Visit ${seen.length}${a?.allowance_kind === 'visits' ? ` of ${a.allowance_total}` : ''} attended${next ? ` · next ${usDay(next.start_at, f.zone)}` : ''}`, cite: cite.visit(f, seen[seen.length - 1]) }
    : next ? { id: 'visits', label: 'Visits', state: 'waiting', text: `First visit ${usDay(next.start_at, f.zone)}`, cite: cite.visit(f, next) } : { id: 'visits', label: 'Visits', state: 'stalled', text: 'No visit booked yet' })
  const unsigned = seen.filter(v => !signedNote(f, v.id)), lastSigned = [...f.notes].filter(n => n.signed_at).sort((x, y) => x.signed_at.localeCompare(y.signed_at)).pop()
  out.push(unsigned.length ? { id: 'notes', label: 'Notes signed', state: 'stalled', text: `${unsigned.length} attended visit${unsigned.length === 1 ? '' : 's'} without a signed note`, cite: cite.visit(f, unsigned[0]) }
    : seen.length ? { id: 'notes', label: 'Notes signed', state: 'done', text: `${seen.length === 1 ? 'Note' : `All ${seen.length} notes`} signed${lastSigned ? ` · latest ${usDay(lastSigned.signed_at, f.zone)}` : ''}`, cite: lastSigned ? cite.note(f, lastSigned) : undefined } : { id: 'notes', label: 'Notes signed', state: 'none', text: 'No attended visits yet' })
  if (!p) { out.push({ id: 'claim', label: 'Claim sent', state: 'none', text: 'Self-pay: no claims' }, { id: 'era', label: 'ERA posted', state: 'none', text: 'Self-pay: no remittances' }) }
  else {
    const sent = f.claims.filter(c => SENT.includes(c.status)), held = f.claims.filter(c => c.status === 'draft'), waiting = unclaimed(f), filed = sent.filter(c => c.status === 'batched')
    const kept = sent.filter(c => c.status === 'exported').length, out1 = sent.length - filed.length - kept
    out.push(held.length ? { id: 'claim', label: 'Claim sent', state: 'stalled', text: `${held.length} claim${held.length === 1 ? '' : 's'} held: ${held[0].errors.length} thing${held[0].errors.length === 1 ? '' : 's'} to fix before it can go to the payer`, cite: cite.claim(f, held[0]), next: { text: `Fix: ${held[0].errors.map((x: any) => x.message).join(' ')}`, href: file(f, `claim-${held[0].id}`) } }
      : waiting.length ? { id: 'claim', label: 'Claim sent', state: 'waiting', text: `${waiting.length} signed visit${waiting.length === 1 ? '' : 's'} not claimed yet`, cite: cite.visit(f, waiting[0]) }
        : filed.length ? { id: 'claim', label: 'Claim sent', state: 'waiting', text: `${filed.length} claim${filed.length === 1 ? ' is' : 's are'} in a claim file not downloaded yet`, cite: cite.claim(f, filed[0]), next: { text: 'Download the 837P claim file and upload it to your clearinghouse or the payer’s portal', href: '/app/insurance#batches' } }
          : sent.length ? { id: 'claim', label: 'Claim sent', state: 'done', text: [out1 ? `${out1} claim${out1 === 1 ? '' : 's'} sent` : '', kept ? `${kept} claim file${kept === 1 ? '' : 's'} downloaded for you to upload (Balm did not send ${kept === 1 ? 'it' : 'them'})` : ''].filter(Boolean).join(' · '), cite: cite.claim(f, sent[sent.length - 1]) } : { id: 'claim', label: 'Claim sent', state: 'none', text: 'No claims yet' })
    const posted = f.claims.filter(c => c.era_trace), pending = sent.filter(c => !c.era_trace)
    const upload = { text: 'When the payer answers, upload its 835 (payment or denial) on the Insurance page', href: ERA }
    out.push(posted.length ? { id: 'era', label: 'ERA posted', state: pending.length ? 'waiting' : 'done', text: `${posted.length} ERA line${posted.length === 1 ? '' : 's'} posted${pending.length ? ` · ${pending.length} waiting on the payer` : ''}`, cite: cite.era(f, posted[posted.length - 1]), ...(pending.length ? { next: upload } : {}) }
      : pending.length ? { id: 'era', label: 'ERA posted', state: 'waiting', text: `${pending.length} claim${pending.length === 1 ? '' : 's'} waiting on the payer`, cite: cite.claim(f, pending[0]), next: upload } : { id: 'era', label: 'ERA posted', state: 'none', text: 'No remittance yet' })
  }
  const fix = f.claims.filter(c => FIX.includes(c.status)), paid = f.claims.filter(c => c.status === 'paid')
  out.push(fix.length ? { id: 'outcome', label: 'Paid or denied', state: 'stalled', text: `${fix[0].status === 'rejected' ? 'Rejected' : fix[0].status === 'partial' ? 'Partly denied' : 'Denied'}: ${fix[0].errors.map((x: any) => /^carc_/.test(x.code) ? `${payerReason(x.code).reason} (${payerReason(x.code).codes[0]})` : x.message).join('; ') || 'see the payer reason'}`, cite: fix[0].era_trace ? cite.era(f, fix[0]) : cite.claim(f, fix[0]) }
    : f.balanceCents > 0 && (paid.length || !p) ? { id: 'outcome', label: 'Paid or denied', state: 'waiting', text: `Patient owes ${dollars(f.balanceCents)}`, cite: cite.statement(f) }
      : paid.length && paid.length === f.claims.length && !unclaimed(f).length ? { id: 'outcome', label: 'Paid or denied', state: 'done', text: `Paid · patient balance ${dollars(Math.max(0, f.balanceCents))}`, cite: cite.era(f, paid[paid.length - 1]) }
        : { id: 'outcome', label: 'Paid or denied', state: 'none', text: `${paid.length ? `${paid.length} of ${f.claims.length} claims paid` : 'Nothing paid yet'}${p ? ': a claim becomes paid or denied when its 835 is posted' : ''}` })
  return out
}

/** The one line a list shows: the first stalled stage, else the furthest one waiting, else reconciled. */
export function standing(list: Stage[]) {
  const stalled = list.find(s => s.state === 'stalled'), waiting = [...list].reverse().find(s => s.state === 'waiting'), last = list[list.length - 1]
  if (stalled) return { state: 'stalled' as const, text: `${stalled.label}: ${stalled.text}` }
  if (waiting) return { state: 'waiting' as const, text: `${waiting.label}: ${waiting.text}` }
  if (last.state === 'done') return { state: 'done' as const, text: 'Reconciled: claims paid and patient balance zero' }
  const reached = [...list].reverse().find(s => s.state === 'done')!
  return { state: 'waiting' as const, text: `${reached.label}: ${reached.text}` }
}
