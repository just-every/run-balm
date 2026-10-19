import { datePlus, firstInstantOfHostDate, hostDateAt } from '../availability/timezone'
import { dollars } from '../domain/invoices'
import { insist, one, stmt, type Data } from '../domain/model'

export type DailyCloseItem = {
  kind: string
  id: string
  clientId: string
  client: string
  label: string
  href: string
}
export type DailyCloseFacts = {
  date: string
  zone: string
  notes: DailyCloseItem[]
  plans: DailyCloseItem[]
  charges: DailyCloseItem[]
  copays: DailyCloseItem[]
  claims: DailyCloseItem[]
  intakes: DailyCloseItem[]
  authorizations: DailyCloseItem[]
}

const displayDate = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(date + 'T00:00:00Z'))

const file = (clientId: string, anchor: string) => `/app/clients/${encodeURIComponent(clientId)}#${encodeURIComponent(anchor)}`
const item = (row: Data, kind: string, label: string, anchor: string): DailyCloseItem => ({
  kind, id: row.id, clientId: row.client_id, client: row.client, label, href: file(row.client_id, anchor),
})
const groupBy = (list: Data[], key: string) => {
  const groups = new Map<string, Data[]>()
  for (const row of list) {
    const group = groups.get(row[key]) ?? []
    group.push(row)
    groups.set(row[key], group)
  }
  return groups
}

/** Internal facts only. The calling handler must resolve authority and audit this
 * clinical aggregate. Never selects note text, intake answers or plan narratives.
 * All backlog through clinic-local today; booked future visits only reserve
 * authorizations and identify uncovered visits after an authorization expires. */
export async function dailyCloseFacts(db: D1Database, at = new Date()): Promise<DailyCloseFacts> {
  const settings = await one(db, 'SELECT s.time_zone,d.late_days FROM bm_settings s JOIN bm_documentation_settings d ON d.id=1 WHERE s.id=1')
  insist(settings, 'clinic_documentation_settings_missing', 409)
  const zone = String(settings.time_zone), date = hostDateAt(at, zone)
  const tomorrow = firstInstantOfHostDate(datePlus(date, 1), zone)
  insist(tomorrow, 'clinic_next_day_missing', 409)
  const cutoff = tomorrow.toISOString()
  const results = await db.batch<Data>([
    stmt(db, `SELECT a.id,a.client_id,a.practitioner_id,a.start_at,a.status,a.checked_in_at,
      c.first_name||' '||c.last_name AS client,c.copay_cents,p.name AS practitioner,
      EXISTS(SELECT 1 FROM bm_notes n WHERE n.appointment_id=a.id AND n.signed_at IS NOT NULL AND julianday(n.signed_at)<julianday(?)) AS signed_note,
      EXISTS(SELECT 1 FROM bm_intake_responses r WHERE r.client_id=a.client_id AND r.form_id=(SELECT id FROM bm_intake_forms ORDER BY number DESC LIMIT 1) AND julianday(r.submitted_at)<julianday(?)) AS current_intake
      FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id JOIN bm_staff p ON p.id=a.practitioner_id
      WHERE a.status IN ('attended','booked') AND julianday(a.created_at)<julianday(?)
      AND (a.status='booked' OR julianday(a.start_at)<julianday(?)) ORDER BY a.start_at,a.id`, cutoff, cutoff, cutoff, cutoff),
    stmt(db, `SELECT n.id,n.client_id,n.appointment_id,n.created_at,c.first_name||' '||c.last_name AS client,p.name AS practitioner
      FROM bm_notes n JOIN bm_clients c ON c.id=n.client_id JOIN bm_staff p ON p.id=n.author_id LEFT JOIN bm_appointments a ON a.id=n.appointment_id
      WHERE n.signed_at IS NULL AND julianday(n.created_at)<julianday(?)
      AND (a.id IS NULL OR julianday(a.start_at)<julianday(?)) ORDER BY n.created_at,n.id`, cutoff, cutoff),
    stmt(db, `SELECT p.id,p.client_id,p.author_id,p.note_id,p.status,p.created_at,
      json_extract(p.content,'$.startDate') AS start_date,json_extract(p.content,'$.certifiedThrough') AS certified_through,
      c.first_name||' '||c.last_name AS client,s.name AS practitioner
      FROM bm_plans_of_care p JOIN bm_clients c ON c.id=p.client_id JOIN bm_staff s ON s.id=p.author_id
      WHERE json_extract(p.content,'$.startDate')<=? AND julianday(p.created_at)<julianday(?)
      ORDER BY json_extract(p.content,'$.startDate') DESC,p.created_at DESC,p.id DESC`, date, cutoff),
    stmt(db, `SELECT i.id,i.appointment_id,i.client_id,i.status,i.amount_cents,a.start_at,c.first_name||' '||c.last_name AS client,
      EXISTS(SELECT 1 FROM bm_claims q WHERE q.invoice_id=i.id AND q.status<>'corrected' AND julianday(q.created_at)<julianday(?)) AS has_claim,
      (SELECT COALESCE(SUM(p.amount_cents),0) FROM bm_payments p WHERE p.invoice_id=i.id AND p.reference NOT LIKE 'era:%'
        AND NOT EXISTS(SELECT 1 FROM bm_card_payments cp WHERE cp.id=p.card_payment_id AND cp.kind='copay' AND cp.appointment_id=i.appointment_id) AND julianday(p.recorded_at)<julianday(?)) AS patient_paid_cents
      FROM bm_invoices i JOIN bm_appointments a ON a.id=i.appointment_id JOIN bm_clients c ON c.id=i.client_id
      WHERE i.status<>'void' AND julianday(a.start_at)<julianday(?) AND julianday(i.prepared_at)<julianday(?) ORDER BY a.start_at,i.id`, cutoff, cutoff, cutoff, cutoff),
    stmt(db, `SELECT appointment_id,SUM(amount_cents) AS cents FROM bm_card_payments
      WHERE kind='copay' AND status='succeeded' AND julianday(succeeded_at)<julianday(?) GROUP BY appointment_id`, cutoff),
    stmt(db, `SELECT q.id,q.client_id,q.status,q.service_date,c.first_name||' '||c.last_name AS client
      FROM bm_claims q JOIN bm_invoices i ON i.id=q.invoice_id JOIN bm_appointments a ON a.id=q.appointment_id JOIN bm_clients c ON c.id=q.client_id
      WHERE q.status IN ('draft','ready','batched','exported') AND i.status<>'void' AND q.service_date<=?
      AND julianday(a.start_at)<julianday(?) AND julianday(q.created_at)<julianday(?) ORDER BY q.service_date,q.id`, date, cutoff, cutoff),
    stmt(db, `SELECT id,client_id,starts_on,ends_on FROM bm_policies ORDER BY priority,starts_on DESC,id`),
    stmt(db, `SELECT z.id,z.policy_id,z.starts_on,z.ends_on,z.visits,z.practitioner_id,p.client_id,
      c.first_name||' '||c.last_name AS client FROM bm_authorizations z JOIN bm_policies p ON p.id=z.policy_id JOIN bm_clients c ON c.id=p.client_id
      ORDER BY z.starts_on DESC,z.id DESC`),
  ])
  const [visits, unsigned, plans, invoices, copayPayments, unsent, policies, authorizations] = results.map(r => r.results)
  const result: DailyCloseFacts = { date, zone, notes: [], plans: [], charges: [], copays: [], claims: [], intakes: [], authorizations: [] }
  const localVisits: (Data & { local_date: string })[] = visits.map(v => ({ ...v, local_date: hostDateAt(new Date(v.start_at), zone) }))
  const throughToday = localVisits.filter(v => v.local_date <= date)
  const invoicesByVisit = groupBy(invoices, 'appointment_id'), policiesByClient = groupBy(policies, 'client_id')
  const copayByVisit = new Map(copayPayments.map(p => [p.appointment_id, Number(p.cents)]))
  const intakeClients = new Set<string>(), latestPlans = new Map<string, Data>()
  for (const plan of plans) {
    const key = JSON.stringify([plan.client_id, plan.author_id])
    if (!latestPlans.has(key)) latestPlans.set(key, plan)
  }

  for (const note of unsigned) result.notes.push(item(note, 'unsigned_note', `Unsigned treatment note · ${note.practitioner} · started ${displayDate(hostDateAt(new Date(note.created_at), zone))}`, `note-${note.id}`))
  const unsignedVisits = new Set(unsigned.map(n => n.appointment_id).filter(Boolean))
  const attendedByPair = new Map<string, Data[]>()
  for (const visit of throughToday) {
    const visitInvoices = invoicesByVisit.get(visit.id) ?? []
    if (visit.status === 'attended') {
      const pair = JSON.stringify([visit.client_id, visit.practitioner_id]), treatments = attendedByPair.get(pair) ?? []
      treatments.push(visit); attendedByPair.set(pair, treatments)
      // A separate unsigned draft remains listed even when this visit has a signed note.
      if (!visit.signed_note && !unsignedVisits.has(visit.id)) result.notes.push(item(visit, 'missing_signed_note', `Attended visit has no signed treatment note · ${displayDate(visit.local_date)} · ${visit.practitioner}`, `visit-${visit.id}`))
      // Attendance-created draft invoices are real charges awaiting review.
      if (!visitInvoices.length) result.charges.push(item(visit, 'missing_charge', `Attended visit has no charge · ${displayDate(visit.local_date)}`, `visit-${visit.id}`))
    }
    if ((visit.status === 'attended' || visit.checked_in_at) && Number(visit.copay_cents) > 0) {
      // Count visit copays once, plus patient payments actually posted to its
      // invoices (card or desk). Payer remittances and unallocated credits do not count.
      const paid = (copayByVisit.get(visit.id) ?? 0) + visitInvoices.reduce((sum, invoice) => sum + Number(invoice.patient_paid_cents), 0)
      const left = Number(visit.copay_cents) - paid
      if (left > 0) result.copays.push(item(visit, 'outstanding_copay', `${dollars(left)} copay outstanding · ${displayDate(visit.local_date)}`, 'billing'))
    }
    if (!visit.current_intake && !intakeClients.has(visit.client_id)) {
      intakeClients.add(visit.client_id)
      result.intakes.push(item({ ...visit, id: visit.client_id }, 'missing_intake', 'Current intake form has not been received', `visit-${visit.id}`))
    }
  }

  for (const [pair, plan] of latestPlans) {
    const treatments = attendedByPair.get(pair) ?? []
    if (plan.status !== 'certified') {
      const first = treatments.find(v => v.local_date >= plan.start_date)?.local_date ?? plan.start_date
      const elapsed = Math.floor((Date.parse(date) - Date.parse(first)) / 86400_000)
      const late = elapsed >= Number(settings.late_days)
      result.plans.push(item(plan, late ? 'late_plan' : 'pending_plan', `${late ? `Plan certification is late (${elapsed} days; clinic deadline ${settings.late_days} days)` : 'Plan awaits physician certification'} · ${plan.practitioner}`, 'plans'))
    } else if (plan.certified_through < date) result.plans.push(item(plan, 'expired_plan', `Plan expired ${displayDate(plan.certified_through)}; recertification needed · ${plan.practitioner}`, 'plans'))
  }
  for (const [pair, treatments] of attendedByPair) if (!latestPlans.has(pair)) {
    const visit = treatments[0]
    result.plans.push(item(visit, 'missing_plan', `No plan of care for attended treatment · ${visit.practitioner}`, 'plans'))
  }

  for (const claim of unsent) result.claims.push(item(claim, 'unsent_claim', `Claim ${claim.status === 'exported' ? 'exported; not sent by Balm' : claim.status === 'draft' ? 'needs fixes before sending' : claim.status === 'batched' ? 'batched; not sent' : 'ready; not sent'} · ${displayDate(claim.service_date)}`, `claim-${claim.id}`))
  for (const invoice of invoices) if (invoice.status === 'approved' && !invoice.has_claim) {
    const serviceDate = hostDateAt(new Date(invoice.start_at), zone)
    if ((policiesByClient.get(invoice.client_id) ?? []).some(p => p.starts_on <= serviceDate && (!p.ends_on || p.ends_on >= serviceDate))) {
      result.claims.push(item(invoice, 'missing_claim', `Insured approved charge has no claim · ${displayDate(serviceDate)}`, `invoice-${invoice.id}`))
    }
  }

  // Bulk equivalent of authorizationsFor: each visit uses the latest matching
  // authorization per policy, and booked visits reserve capacity, including future ones.
  const authByClient = groupBy(authorizations, 'client_id')
  const counters = new Map(authorizations.map(a => [a.id, { used: 0, reserved: 0 }]))
  const expiredWithBookings = new Set<string>()
  for (const visit of localVisits) {
    const choices = (authByClient.get(visit.client_id) ?? []).filter(a => !a.practitioner_id || a.practitioner_id === visit.practitioner_id)
    const allocated = new Set<string>()
    for (const auth of choices) if (!allocated.has(auth.policy_id) && auth.starts_on <= visit.local_date && auth.ends_on >= visit.local_date) {
      allocated.add(auth.policy_id)
      const counter = counters.get(auth.id)!
      visit.status === 'attended' ? counter.used++ : counter.reserved++
    }
    if (visit.status === 'booked' && visit.local_date > date) {
      const considered = new Set<string>()
      for (const auth of choices) if (!allocated.has(auth.policy_id) && !considered.has(auth.policy_id) && auth.starts_on <= date) {
        considered.add(auth.policy_id)
        if (auth.ends_on < date) expiredWithBookings.add(auth.id)
      }
    }
  }
  for (const auth of authorizations) {
    const counts = counters.get(auth.id)!, left = Math.max(0, Number(auth.visits) - counts.used - counts.reserved)
    if (auth.starts_on <= date && auth.ends_on >= date && left <= 2) result.authorizations.push(item(auth, 'low_authorization', `${left} unreserved authorized visits remain · expires ${displayDate(auth.ends_on)}`, 'insurance'))
    else if (expiredWithBookings.has(auth.id)) result.authorizations.push(item(auth, 'expired_authorization', `Authorization expired ${displayDate(auth.ends_on)}; future booked visits need coverage`, 'insurance'))
  }
  return result
}
