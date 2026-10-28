// The next steps the agent lines up for a case. Every rule is plain code over
// the case's records; the AI key only ever rewords a letter's request paragraph.
// A step's digest covers what it rests on, so an approval given on a page that
// has since changed is refused instead of acting on facts nobody reviewed.
import { payerReason } from '../insurance/codes'
import { dollars, invoiceNumber } from '../domain/invoices'
import { sha256 } from '../domain/model'
import { template } from '../charting/templates'
import { authorizationCorrection, claimAuthorization } from '../insurance/claim-authorization'
import { attended, cite, currentAuthorization, EXPIRY_DAYS, FIX, signedNote, STALE_DAYS, unclaimed, usDay } from './stages'
import type { CaseFacts, Step } from './types'

export const STATEMENT_DAYS = 14
const days = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400_000)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The latest signed note in the case, a progress report first: what a payer reads to authorize more visits. */
export function supportingNote(f: CaseFacts) {
  const signed = f.notes.filter(n => n.signed_at).sort((a, b) => a.signed_at.localeCompare(b.signed_at))
  return [...signed].reverse().find(n => template(n.template)?.kind === 'progress') ?? signed[signed.length - 1] ?? null
}

/** The letter's fixed lines: who and what, from the records. Only the request paragraph is wording. */
export function letterHead(f: CaseFacts, a: any) {
  const p = f.policy!, r = f.referral
  return [`To: ${p.payer_name}, utilization management`, 'Re: Request for continued authorization of outpatient therapy visits', '',
    `Patient: ${f.client.first_name} ${f.client.last_name}${f.client.date_of_birth ? `, born ${usDay(f.client.date_of_birth, f.zone)}` : ''}`,
    `Member ID: ${p.member_id}${p.group_number ? ` · Group ${p.group_number}` : ''}`,
    a ? `Current authorization: ${a.number}, ${a.allowance_total} ${a.allowance_kind} from ${usDay(a.starts_on, f.zone)} to ${usDay(a.ends_on, f.zone)}; ${a.used_allowance} used, ${a.reserved_allowance} ${a.allowance_kind === 'units' ? 'reserved' : 'booked'}, ${a.left} left` : 'New authorization for the denied visit: not yet recorded',
    `Referring provider: ${r.referring_first} ${r.referring_last}${r.referring_npi ? `, NPI ${r.referring_npi}` : ''}`,
    ...(r.diagnosis ? [`Diagnosis: ${r.diagnosis}`] : []),
    `Treating clinic: ${f.clinic.clinic_name}${f.clinic.billing_npi ? `, billing NPI ${f.clinic.billing_npi}` : ''}`].join('\n')
}
export function letterFoot(f: CaseFacts, note: any) {
  return `${note ? `Attached: ${template(note.template)?.title ?? 'Treatment note'}, signed ${usDay(note.signed_at, f.zone)} by ${note.signer_name}${note.signer_credentials ? ', ' + note.signer_credentials : ''}.\n\n` : ''}Please reply to this email with your decision and the new authorization number.\n\n${f.clinic.clinic_name}`
}
/** The request paragraph Balm writes without an AI key. */
export function standardRequest(f: CaseFacts, a: any, denied?: any) {
  const seen = attended(f).length
  if (!a) return `We request authorization for outpatient therapy under the plan of care, including the visit on ${usDay(denied.service_date, f.zone)} that was denied for a missing authorization. The patient has attended ${plural(seen, 'visit')} under this referral, and the attached signed note records the patient's progress and the goals that remain.`
  return `We request ${a.allowance_total} further ${a.allowance_kind} to continue the plan of care. The patient has attended ${plural(seen, 'visit')} under this referral and has ${plural(a.left, a.allowance_kind === 'units' ? 'authorized unit' : 'authorized visit')} left${a.ends_on >= f.today ? ` before the authorization ends on ${usDay(a.ends_on, f.zone)}` : ''}. The attached signed note records the patient's progress and the goals that remain.`
}

async function digestOf(step: Omit<Step, 'digest'>) {
  return sha256(JSON.stringify([step.key, step.kind, step.title, step.why, step.citations, step.sends ?? null, step.blocked ?? null]))
}

export async function steps(f: CaseFacts): Promise<Step[]> {
  const taken = new Set(f.done.filter(d => d.status !== 'failed').map(d => d.step_key)), out: Omit<Step, 'digest'>[] = []
  const p = f.policy, a = currentAuthorization(f), next = f.visits.find(v => v.status === 'booked' && Date.parse(v.start_at) >= Date.now())
  const authorization = (c: any) => claimAuthorization(f.authorizations, c.policy_id, c.service_date, f.visits.find(v => v.id === c.appointment_id)?.practitioner_id, authorizationCorrection(c))
  const missingAuthorization = f.claims.filter(c => FIX.includes(c.status) && authorizationCorrection(c) && !authorization(c))

  if (p) {
    const checked = p.eligibility_checked_at as string | null, pending = f.eligibility && !f.eligibility.checked_at
    const stale = !checked || p.eligibility_status !== 'active' || days(checked.slice(0, 10), f.today) > STALE_DAYS
    if (stale && !pending) out.push({
      key: `eligibility.check:${p.id}:${checked ?? 'never'}`, kind: 'eligibility.check', button: 'Check eligibility', draftable: false,
      title: `${checked ? 'Re-verify' : 'Verify'} ${p.payer_name} eligibility${next ? ` before ${usDay(next.start_at, f.zone)}` : ''}`,
      why: !checked ? 'Coverage has never been checked for this case.' : p.eligibility_status !== 'active' ? `The latest eligibility response says coverage is ${p.eligibility_status}.` : `Coverage was last checked ${usDay(checked, f.zone)}, more than ${STALE_DAYS} days ago.`,
      citations: [cite.policy(f), ...(f.eligibility ? [cite.eligibility(f)] : []), ...(next ? [cite.visit(f, next)] : [])],
    })
  }

  const low = a && (a.left <= a.low_remainder || days(f.today, a.ends_on) <= EXPIRY_DAYS)
  if (p && (low || missingAuthorization.length)) {
    const note = supportingNote(f), base = low ? a : null, denial = missingAuthorization[0]
    const key = low ? `authorization.request:${a.id}:${a.allowance_total}:${a.ends_on}` : `authorization.request:claim:${denial.id}`
    const why = low ? `Only ${plural(a.left, a.allowance_kind === 'units' ? 'authorized unit' : 'authorized visit')} of ${a.allowance_total} ${a.left === 1 ? 'is' : 'are'} left (${a.used_allowance} used, ${a.reserved_allowance} ${a.allowance_kind === 'units' ? 'reserved' : 'booked'}), and the authorization ${a.ends_on < f.today ? 'ended' : 'ends'} ${usDay(a.ends_on, f.zone)}.`
      : `The payer denied the claim for ${usDay(denial.service_date, f.zone)} for a missing authorization (CARC 197). Record a new payer authorization after the denial, with a different number covering that visit and its treating practitioner.`
    const draft = f.drafts.find(d => d.step_key === key)
    out.push({
      key, kind: 'authorization.request', button: 'Send to payer', draftable: true,
      title: `Request more authorized ${a?.allowance_kind ?? 'visits'} from ${p.payer_name}`, why,
      blocked: f.referral.authorization_email ? undefined : 'Add where this payer takes authorization requests (the case’s authorization contact) before Balm can send it.',
      sends: f.referral.authorization_email ? { to: f.referral.authorization_email, subject: `Authorization request: ${p.payer_name} member ${p.member_id}`, fixed: letterHead(f, base), ...(note ? { attachment: { noteId: note.id, label: `${template(note.template)?.title ?? 'Treatment note'} signed ${usDay(note.signed_at, f.zone)} (PDF)` } } : {}) } : undefined,
      wording: draft?.wording ?? standardRequest(f, base, denial),
      citations: [...(base ? [cite.authorization(f, base)] : []), ...attended(f).slice(-1).map(v => cite.visit(f, v)), ...(note ? [cite.note(f, note)] : []), ...(denial ? [cite.claim(f, denial), ...(denial.era_trace ? [cite.era(f, denial)] : [])] : []), cite.referral(f)],
    })
  }

  if (p) for (const v of unclaimed(f)) {
    const invoice = f.invoices.find(i => i.appointment_id === v.id && i.status === 'approved')!, note = signedNote(f, v.id)!
    out.push({
      key: `claim.send:${v.id}`, kind: 'claim.send', button: 'Send to payer', draftable: false,
      title: `Send the claim for ${usDay(v.start_at, f.zone)} to ${p.payer_name}`,
      why: `The visit is attended, its note is signed and ${invoiceNumber(invoice.number)} is approved, but no claim has been made.`,
      citations: [cite.visit(f, v), cite.note(f, note), { kind: 'invoice', label: `${invoiceNumber(invoice.number)} approved, ${dollars(invoice.amount_cents)}`, href: `/app/clients/${f.client.id}#invoice-${invoice.id}` }, cite.policy(f)],
    })
  }

  for (const c of f.claims.filter(c => FIX.includes(c.status))) {
    const v = f.visits.find(x => x.id === c.appointment_id), note = v && signedNote(f, v.id), auth = authorization(c)
    const needsAuth = missingAuthorization.includes(c)
    out.push({
      key: `denial.fix:${c.id}`, kind: 'denial.fix', button: 'Correct and resubmit', draftable: false,
      title: `Fix and resubmit the ${c.status === 'rejected' ? 'rejected' : 'denied'} claim for ${usDay(c.service_date, f.zone)}`,
      why: c.errors.map((e: any) => /^carc_/.test(e.code) ? payerReason(e.code,e.message).reason : e.message.trim()).join(' ') || 'The payer did not pay this claim. Review the remittance before resubmitting.',
      blocked: needsAuth ? `Record a new payer authorization after this denial on the policy, with a different number covering ${usDay(c.service_date, f.zone)} and its treating practitioner. The authorization on the denied claim was ${c.snapshot.authorization ?? 'not recorded'}; resubmitting it would be denied again.` : undefined,
      citations: [cite.claim(f, c), ...(c.era_trace ? [cite.era(f, c)] : c.acknowledgment ? [{kind:'acknowledgment' as const,label:`277CA ${JSON.parse(c.acknowledgment.detail).statuses.map((s:any)=>`${s.category}:${s.status}:${s.entity}`).join(', ')}`,href:`/app/clients/${f.client.id}#claim-${c.id}`}] : []), ...(v ? [cite.visit(f, v)] : []), ...(note ? [cite.note(f, note)] : []), ...(auth ? [cite.authorization(f, { ...auth })] : [])],
    })
  }

  const settled = f.claims.some(c => c.status === 'paid' || c.status === 'partial') || !p
  if (f.balanceCents > 0 && settled && (!f.lastStatementAt || days(f.lastStatementAt.slice(0, 10), f.today) >= STATEMENT_DAYS)) out.push({
    key: `statement.send:${f.balanceCents}:${f.lastStatementAt ?? 'none'}`, kind: 'statement.send', button: 'Email statement', draftable: false,
    title: `Send ${f.client.first_name} a statement for ${dollars(f.balanceCents)}`,
    why: `${p ? 'The payer has paid its share and ' : ''}${dollars(f.balanceCents)} is the patient’s to pay${f.lastStatementAt ? `; the last statement went ${usDay(f.lastStatementAt, f.zone)}` : '; no statement has been sent'}.`,
    blocked: f.client.email ? undefined : 'The patient’s file has no email address.',
    sends: f.client.email ? { to: f.client.email, subject: `Your statement from ${f.clinic.clinic_name}` } : undefined,
    citations: [cite.statement(f), ...f.claims.filter(c => c.era_trace && c.pr_cents > 0).map(c => cite.era(f, c))],
  })

  return Promise.all(out.filter(s => !taken.has(s.key)).map(async s => ({ ...s, digest: await digestOf(s) })))
}
