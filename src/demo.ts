// Demo data for `rer demo` and the hosted demo (modules/demo runs it once, after
// the owner exists): Cedar Grove Physical Therapy, a lived-in clinic with four
// practitioners, a fortnight of bookings in every state, completed intake forms,
// private treatment notes, approved and paid invoices, drafts waiting for a
// person, and the access audit those leave. Rows are shaped by Balm's own domain
// code (invoice snapshots and artifacts, reminder facts, intake form validation,
// the booking time zone helpers). Fixed ids with ON CONFLICT DO NOTHING keep it
// idempotent; nothing is fetched or sent.
import type { Bindings } from './auth.server'
import { artifact, invoiceNumber, snapshot } from './balm/domain/invoices'
import { currentForm, questions } from './balm/domain/intake'
import { sha256 } from './balm/domain/model'
import { facts, reminderPayload, reminderText } from './balm/domain/reminders'
import { amendment, noteBody } from './balm/demo/notes'
import { clients, clinic, former, movedIn, practitioners, reception, services, zone } from './balm/demo/people'
import { DAY, HOUR, MIN, plan, type Visit } from './balm/demo/visits'

const iso = (at: number) => new Date(at).toISOString()

export async function seedDemo(env: Bindings, { ownerEmail, now: seededAt }: { ownerEmail: string; now: Date }) {
  const db = env.DB, now = seededAt.getTime()
  const owner = await db.prepare("SELECT id,version FROM oa_operators WHERE lower(email)=lower(?) AND role='owner' AND status='active'").bind(ownerEmail).first<{ id: string; version: number }>()
  if (!owner) throw new Error('The demo clinic needs its owner first')
  const q = (sql: string, ...values: unknown[]) => db.prepare(sql).bind(...values)
  const desk = { email: reception.email, role: 'reception' }, maya = { email: ownerEmail, role: 'owner' }, agent = { email: ownerEmail, role: 'agent' }
  const staffEmail = (id: string) => practitioners.find(p => p.id === id)?.email ?? ownerEmail
  const actorOf = (id: string) => id === 'demo-staff-maya' ? maya : { email: staffEmail(id), role: 'practitioner' }
  // The audit is append-only with no natural key: each entry is written once per (action, subject, time).
  const log = (at: number, who: { email: string; role: string }, action: string, clientId: string | null, subjectId: string, detail = '') =>
    q(`INSERT INTO bm_audit(at,actor_email,actor_role,action,client_id,subject_id,detail) SELECT ?,?,?,?,?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM bm_audit WHERE action=? AND subject_id=? AND at=?)`, iso(at), who.email, who.role, action, clientId, subjectId, detail, action, subjectId, iso(at))
  const visits = plan(now)
  const firstSeen = new Map<string, Visit>()
  for (const v of visits) if (!firstSeen.has(v.client.id)) firstSeen.set(v.client.id, v)

  // The clinic, its people and its week, in one batch.
  const clinicRows = [
    q("UPDATE bm_settings SET clinic_name=?,time_zone=?,abn=?,address=?,version=version+1 WHERE id=1 AND clinic_name='My clinic'", clinic.name, zone, clinic.taxId, clinic.address),
    q('INSERT INTO oa_first_run(singleton,completed_by,completed_at) VALUES(1,?,?) ON CONFLICT(singleton) DO NOTHING', owner.id, now - 30 * DAY),
    ...practitioners.map(p => q("INSERT INTO bm_staff(id,name,email,role,profession,provider_number) VALUES(?,?,?,'practitioner',?,?) ON CONFLICT DO NOTHING", p.id, p.name, p.email ?? ownerEmail.toLowerCase(), p.profession, p.providerNumber)),
    q("INSERT INTO bm_staff(id,name,email,role) VALUES(?,?,?,'reception') ON CONFLICT DO NOTHING", reception.id, reception.name, reception.email),
    q("INSERT INTO bm_staff(id,name,email,role,profession,provider_number,active) VALUES(?,?,?,'practitioner',?,?,0) ON CONFLICT DO NOTHING", former.id, former.name, former.email, former.profession, former.providerNumber),
    ...services.map(s => q('INSERT INTO bm_services(id,name,duration_minutes,price_cents,active) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING', s.id, s.name, s.minutes, s.cents, s.active === false ? 0 : 1)),
    ...practitioners.flatMap(p => p.hours.map(([weekday, start, end]) => q('INSERT INTO bm_hours(practitioner_id,weekday,start_minute,end_minute) VALUES(?,?,?,?) ON CONFLICT DO NOTHING', p.id, weekday, start, end))),
    q('INSERT INTO bm_agent_keys(id,owner_id,owner_version,label,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',
      'demo-agent-key', owner.id, owner.version, 'Front desk assistant', await sha256('demo-agent-key:' + crypto.randomUUID()), now - 12 * DAY, now + 18 * DAY),
  ]
  const clientRows = clients.flatMap(c => {
    const first = firstSeen.get(c.id)!, online = first.via === 'online', at = online ? first.createdAt : first.createdAt - 2 * DAY
    return [
      q('INSERT INTO bm_clients(id,first_name,last_name,date_of_birth,email,phone,created_at,created_via) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING', c.id, c.first, c.last, c.dob, c.email, c.phone, iso(at), online ? 'online' : 'staff'),
      log(at, online ? { email: c.email, role: 'online booking' } : desk, 'client.created', c.id, c.id, online ? 'online booking' : ''),
    ]
  })
  clientRows.push(
    q("INSERT INTO bm_clients(id,first_name,last_name,date_of_birth,email,phone,created_at,created_via) VALUES(?,?,?,?,?,?,?,'import') ON CONFLICT DO NOTHING", movedIn.id, movedIn.first, movedIn.last, movedIn.dob, movedIn.email, movedIn.phone, iso(now - 20 * DAY)),
    log(now - 20 * DAY, maya, 'client.created', movedIn.id, movedIn.id, 'Cliniko move-in'))
  const visitRows = await Promise.all(visits.map(async v => {
    const c = v.client, booker = v.via === 'online' ? { email: c.email, role: 'online booking' } : v.seq % 4 === 0 ? maya : desk
    const rows = [
      q(`INSERT INTO bm_appointments(id,client_id,practitioner_id,service_id,start_at,end_at,status,booked_via,intake_token_hash,created_at,created_by,version)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`, v.id, c.id, v.practitioner.id, v.service.id, iso(v.start), iso(v.end), v.status, v.via,
      await sha256('demo-intake:' + v.id), iso(v.createdAt), booker.email, v.status === 'booked' ? 1 : 2),
      log(v.createdAt, booker, 'appointment.booked', c.id, v.id, `${v.via} ${iso(v.start)}`),
    ]
    if (v.status !== 'booked') rows.push(log(v.changedAt, v.status === 'cancelled' ? desk : actorOf(v.practitioner.id), 'appointment.' + v.status, c.id, v.id))
    if (v.intakeAt) {
      const answers = { reason: c.reason, history: c.history, conditions: c.conditions, medications: c.medications, emergency: c.emergency, consent: true }
      rows.push(q("INSERT INTO bm_intake_responses(id,appointment_id,client_id,form_id,answers,submitted_at) VALUES(?,?,?,'intake-v1',?,?) ON CONFLICT DO NOTHING", 'demo-intake-' + v.id, v.id, c.id, JSON.stringify(answers), iso(v.intakeAt)),
        log(v.intakeAt, { email: 'intake link holder', role: 'client' }, 'intake.submitted', c.id, 'demo-intake-' + v.id, 'form v1'))
    }
    if (v.status === 'attended') {
      const noteId = 'demo-note-' + v.id, written = Math.min(v.end + 10 * MIN, now - 5 * MIN), author = actorOf(v.practitioner.id), fix = amendment(v)
      if (v.intakeAt) rows.push(log(v.start - 10 * MIN, author, 'file.viewed', c.id, c.id, 'intake 1; notes 0'), log(v.start - 10 * MIN + 1000, author, 'intake.read', c.id, 'demo-intake-' + v.id))
      rows.push(q('INSERT INTO bm_notes(id,client_id,appointment_id,author_id,created_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING', noteId, c.id, v.id, v.practitioner.id, iso(written)),
        q("INSERT INTO bm_note_revisions(note_id,number,body,reason,written_at) VALUES(?,1,?,'',?) ON CONFLICT DO NOTHING", noteId, noteBody(v), iso(written)),
        log(written, author, 'note.written', c.id, noteId))
      if (fix && written + DAY < now) rows.push(q('INSERT INTO bm_note_revisions(note_id,number,body,reason,written_at) VALUES(?,2,?,?,?) ON CONFLICT DO NOTHING', noteId, fix.body, fix.reason, iso(written + DAY)),
        log(written + DAY, author, 'note.amended', c.id, noteId, 'revision 2'))
    }
    return rows
  }))
  await db.batch([...clinicRows, ...clientRows, ...visitRows.flat()])

  // Billing reads the stored visits back through the invoice snapshot, as approval does.
  const attended = visits.filter(v => v.status === 'attended')
  const issued = attended.filter(v => v.end < now - 2 * DAY), recent = attended.filter(v => v.end >= now - 2 * DAY && v.seq % 2 === 0)
  const corrected = issued.find(v => v.number > 1 && v.end < now - 5 * DAY)
  type Bill = { id: string; visit: Visit; cents: number; status: 'draft' | 'approved' | 'void'; preparedBy: { email: string; role: string }; preparedAt: number; approvedAt?: number; voidReason?: string }
  // Older clients get the clinic's 15% senior rate.
  const price = (v: Visit) => v.client.dob < '1960-01-01' ? Math.round(v.service.cents * 0.85) : v.service.cents
  const bills: Bill[] = []
  for (const v of issued) {
    const preparedAt = v.end + 30 * MIN, preparedBy = v.seq % 3 === 0 ? agent : desk
    if (v === corrected) bills.push({ id: 'demo-invoice-void-' + v.id, visit: v, cents: services[0].cents, status: 'void', preparedBy: desk, preparedAt, approvedAt: v.end + 6 * HOUR, voidReason: 'Billed at the initial assessment rate by mistake' })
    bills.push({ id: 'demo-invoice-' + v.id, visit: v, cents: price(v), status: 'approved', preparedBy, preparedAt: v === corrected ? v.end + 26 * HOUR : preparedAt, approvedAt: v.end + (v === corrected ? 27 : 20) * HOUR })
  }
  for (const v of recent) bills.push({ id: 'demo-invoice-' + v.id, visit: v, cents: price(v), status: 'draft', preparedBy: v.seq % 4 === 0 ? agent : desk, preparedAt: Math.min(v.end + 30 * MIN, now - 5 * MIN) })
  let number = 1040
  const billing = []
  for (const b of bills.sort((x, y) => (x.approvedAt ?? Infinity) - (y.approvedAt ?? Infinity))) {
    const v = b.visit, frozen = JSON.stringify((await snapshot(db, v.id, b.cents)).value)
    const approver = b.preparedBy.role === 'agent' ? desk : maya
    billing.push(log(b.preparedAt, b.preparedBy, 'invoice.prepared', v.client.id, b.id, `${b.cents} cents`))
    if (b.status === 'draft') {
      billing.push(q("INSERT INTO bm_invoices(id,appointment_id,client_id,status,amount_cents,snapshot,prepared_by,prepared_role,prepared_at) VALUES(?,?,?,'draft',?,?,?,?,?) ON CONFLICT DO NOTHING",
        b.id, v.id, v.client.id, b.cents, frozen, b.preparedBy.email, b.preparedBy.role, iso(b.preparedAt)))
      continue
    }
    const n = ++number, approvedAt = Math.min(b.approvedAt!, now - HOUR), bytes = artifact(n, JSON.parse(frozen), iso(approvedAt))
    billing.push(
      q(`INSERT INTO bm_invoices(id,number,appointment_id,client_id,status,amount_cents,snapshot,artifact,artifact_sha256,prepared_by,prepared_role,prepared_at,approved_by,approved_at,void_reason,version)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`, b.id, n, v.id, v.client.id, b.status, b.cents, frozen, bytes, await sha256(bytes),
      b.preparedBy.email, b.preparedBy.role, iso(b.preparedAt), approver.email, iso(approvedAt), b.voidReason ?? null, b.status === 'void' ? 3 : 2),
      q('INSERT INTO bm_approvals(id,subject_type,subject_id,prepared_by,prepared_role,approved_by,approved_at,sha256) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',
        'demo-approval-' + b.id, 'invoice', b.id, b.preparedBy.email, b.preparedBy.role, approver.email, iso(approvedAt), await sha256(frozen)),
      log(approvedAt, approver, 'invoice.approved', v.client.id, b.id, invoiceNumber(n)))
    if (b.status === 'void') { billing.push(log(approvedAt + 19 * HOUR, maya, 'invoice.voided', v.client.id, b.id)); continue }
    // Most visits are paid at the desk; a few are part-paid or still outstanding.
    const paid = v.seq % 7 === 6 ? 0 : v.seq % 7 === 5 ? Math.round(b.cents / 2) : b.cents
    if (paid) {
      const at = Math.min(approvedAt + (1 + v.seq % 30) * HOUR, now - 10 * MIN), id = 'demo-payment-' + v.id
      const reference = [`Card terminal #${4100 + v.seq}`, `HSA card #${5500 + v.seq}`, `Cash receipt ${210 + v.seq}`, `Check #${1100 + v.seq}`][v.seq % 4]
      billing.push(q('INSERT INTO bm_payments(id,invoice_id,amount_cents,reference,recorded_by,recorded_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING', id, b.id, paid, reference, reception.email, iso(at)),
        log(at, desk, 'payment.recorded', v.client.id, id, `${paid} cents`))
    }
  }

  // Reminder texts for the coming days: two waiting for approval, one approved.
  const upcoming = visits.filter(v => v.status === 'booked' && v.start > now + 12 * HOUR).slice(0, 3)
  for (const [i, v] of upcoming.entries()) {
    const { row, basis } = await facts(db, v.id), payload = reminderPayload(row), id = 'demo-reminder-' + v.id
    const by = i === 0 ? agent : desk, at = now - (i === 2 ? 26 : 3 - i) * HOUR
    billing.push(q("INSERT INTO bm_drafts(id,type,status,payload,basis,client_id,prepared_by,prepared_role,prepared_at) VALUES(?,'reminder',?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
      id, i === 2 ? 'approved' : 'draft', JSON.stringify(payload), basis, v.client.id, by.email, by.role, iso(at)), log(at, by, 'reminder.prepared', v.client.id, id))
    if (i === 2) billing.push(q('INSERT INTO bm_approvals(id,subject_type,subject_id,prepared_by,prepared_role,approved_by,approved_at,sha256) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',
      'demo-approval-' + id, 'reminder', id, by.email, by.role, ownerEmail, iso(at + HOUR), await sha256(reminderText(payload))), log(at + HOUR, maya, 'reminder.approved', v.client.id, id))
  }
  // The assistant's suggested intake form update, waiting for the owner to publish it.
  const form = await currentForm(db)
  const proposal = { title: form.title, questions: questions([...form.questions.slice(0, -1),
    { id: 'pain_today', label: 'On a scale of 0 to 10, how much pain do you have today?', type: 'short', required: false },
    { id: 'goals', label: 'What would you most like to get back to doing?', type: 'long', required: false }, form.questions[form.questions.length - 1]]) }
  billing.push(q("INSERT INTO bm_drafts(id,type,status,payload,basis,prepared_by,prepared_role,prepared_at) VALUES('demo-intake-v2','intake','draft',?,?,?,?,?) ON CONFLICT DO NOTHING",
    JSON.stringify(proposal), String(form.number), ownerEmail, 'agent', iso(now - 2 * DAY)), log(now - 2 * DAY, agent, 'intake.prepared', null, 'demo-intake-v2'))
  await db.batch(billing)
}
